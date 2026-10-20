import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Team } from '../engine/types';
import { bannerTexture, brickTexture, recolorRed } from './textures';

export interface ModelEntry {
  file: string;
  /** Rotation (radians) to make the model face +Z. */
  yaw?: number;
  /** Override the height the model is scaled to (tiles). */
  height?: number;
}

interface Proto {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Materials for the enemy team (blue -> red textures). */
  redMats: Map<THREE.Material, THREE.Material>;
  size: THREE.Vector3;
  entry: ModelEntry;
}

const BASE = `${import.meta.env.BASE_URL}assets/models/`;
const protos = new Map<string, Proto>();

export async function loadModels(onProgress?: (f: number) => void): Promise<void> {
  let manifest: Record<string, ModelEntry> = {};
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (res.ok) manifest = await res.json();
  } catch {
    manifest = {};
  }
  const loader = new GLTFLoader();
  const entries = Object.entries(manifest);
  let done = 0;
  await Promise.all(
    entries.map(async ([key, entry]) => {
      try {
        const gltf = await loader.loadAsync(BASE + entry.file);
        const scene = gltf.scene;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = false;
            m.frustumCulled = false;
            // Hunyuan/trimesh materials omit metallicFactor, which glTF defaults to 1 (black
            // without an env map). These are painted, non-metal surfaces.
            for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
              const std = mat as THREE.MeshStandardMaterial;
              if ('metalness' in std) {
                std.metalness = 0;
                std.roughness = Math.min(0.85, std.roughness ?? 0.85);
              }
            }
          }
        });
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const redMats = new Map<THREE.Material, THREE.Material>();
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            if (redMats.has(mat)) continue;
            const std = mat as THREE.MeshStandardMaterial;
            const red = std.clone();
            const img = std.map?.image as (HTMLImageElement | ImageBitmap | HTMLCanvasElement) | undefined;
            if (img && 'width' in img) {
              const t = new THREE.CanvasTexture(recolorRed(img as HTMLCanvasElement));
              t.colorSpace = THREE.SRGBColorSpace;
              t.flipY = std.map!.flipY;
              t.wrapS = std.map!.wrapS;
              t.wrapT = std.map!.wrapT;
              t.channel = std.map!.channel;
              red.map = t;
            }
            redMats.set(mat, red);
          }
        });
        protos.set(key, { scene, clips: gltf.animations, redMats, size, entry });
      } catch (e) {
        console.warn('model failed', key, e);
      }
      done++;
      onProgress?.(done / Math.max(1, entries.length));
    }),
  );
}

export function hasModel(key: string): boolean {
  return protos.has(key);
}

export interface ModelInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  materials: THREE.MeshStandardMaterial[];
  /** Model height in world units after scaling. */
  height: number;
}

/**
 * Clone a model, scaled so it is `targetHeight` tall (or `targetWidth` wide for structures),
 * feet on y=0, facing +Z.
 */
export function instantiate(key: string, team: Team, targetHeight: number, targetWidth?: number): ModelInstance | null {
  const p = protos.get(key);
  if (!p) return null;
  const clone = SkeletonUtils.clone(p.scene);
  const materials: THREE.MeshStandardMaterial[] = [];
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const swap = (mat: THREE.Material) => {
      const src = team === 1 ? (p.redMats.get(mat) ?? mat) : mat;
      const own = (src as THREE.MeshStandardMaterial).clone();
      own.emissive = new THREE.Color(0x000000);
      materials.push(own);
      return own;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  const h = p.entry.height ?? targetHeight;
  const scale = targetWidth ? targetWidth / Math.max(p.size.x, p.size.z) : h / p.size.y;
  const holder = new THREE.Group();
  clone.scale.setScalar(scale);
  clone.rotation.y = p.entry.yaw ?? 0;
  // Re-centre feet at the origin.
  const box = new THREE.Box3().setFromObject(clone);
  const c = box.getCenter(new THREE.Vector3());
  clone.position.set(-c.x, -box.min.y, -c.z);
  holder.add(clone);
  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  if (p.clips.length) {
    mixer = new THREE.AnimationMixer(clone);
    for (const clip of p.clips) actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
  }
  return { root: holder, mixer, actions, materials, height: p.size.y * scale };
}

/**
 * Merge every unnamed mesh in a static group into one mesh per material (named meshes are kept
 * separate so they can still be animated). Cuts draw calls dramatically.
 */
export function mergeByMaterial(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name) {
      keep.push(m);
      return;
    }
    const geo = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
    geo.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    const mat = m.material as THREE.Material;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(geo.index ? geo : geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const indexed = geos.map((g) => (g.index ? g : g.toNonIndexed()));
    const allIndexed = indexed.every((g) => g.index);
    const merged = mergeGeometries(allIndexed ? indexed : indexed.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const k of keep) {
    const m = k as THREE.Mesh;
    const clone = m.clone();
    clone.matrix.copy(inv.clone().multiply(m.matrixWorld));
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  return out;
}

// ---------------------------------------------------------------- procedural towers (fallback)

const stoneTex = brickTexture('#b8b0a2', '#6d675d', 8, 6);
const roofColor: Record<Team, string> = { 0: '#2f6bff', 1: '#e0303c' };
const bannerTex: Record<Team, THREE.Texture> = {
  0: bannerTexture('#2f6bff', '#1d3f99'),
  1: bannerTexture('#e0303c', '#8f1520'),
};

export function proceduralTower(type: 'keep' | 'watch', team: Team): ModelInstance {
  const g = new THREE.Group();
  const materials: THREE.MeshStandardMaterial[] = [];
  const mat = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(o);
    materials.push(m);
    return m;
  };
  const stone = mat({ map: stoneTex, roughness: 0.9 });
  const darkStone = mat({ color: '#8a8378', roughness: 0.95 });
  const gold = mat({ color: '#ffcf4a', metalness: 0.7, roughness: 0.35 });
  const roof = mat({ color: roofColor[team], roughness: 0.6 });
  const bannerMat = mat({ map: bannerTex[team], side: THREE.DoubleSide, roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  if (type === 'watch') {
    add(new THREE.CylinderGeometry(1.25, 1.45, 2.6, 20), stone, 0, 1.3, 0);
    add(new THREE.CylinderGeometry(1.6, 1.4, 0.4, 20), darkStone, 0, 2.75, 0);
    add(new THREE.TorusGeometry(1.42, 0.06, 6, 24), gold, 0, 2.55, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      add(new THREE.BoxGeometry(0.42, 0.45, 0.32), stone, Math.cos(a) * 1.45, 3.17, Math.sin(a) * 1.45).rotation.y = -a;
    }
    // Door and banners.
    add(new THREE.BoxGeometry(0.7, 1.0, 0.1), mat({ color: '#5a3a1e' }), 0, 0.5, 1.42);
    for (const a of [Math.PI * 0.25, Math.PI * 0.75]) {
      const b = add(new THREE.PlaneGeometry(0.6, 1.2), bannerMat, Math.cos(a) * 1.4, 1.75, Math.sin(a) * 1.4);
      b.rotation.y = -a + Math.PI / 2;
    }
    // Pennant pole.
    add(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), gold, 0.9, 3.6, -0.9);
    add(new THREE.ConeGeometry(0.3, 0.8, 4), roof, 0.9, 4.1, -0.65).rotation.x = Math.PI / 2;
  } else {
    add(new THREE.BoxGeometry(3.4, 2.6, 3.4), stone, 0, 1.3, 0);
    add(new THREE.BoxGeometry(3.7, 0.35, 3.7), darkStone, 0, 2.75, 0);
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 4; k++) {
        const t = -1.55 + k * 1.03;
        const side = [
          [t, 1.75],
          [t, -1.75],
          [1.75, t],
          [-1.75, t],
        ][i];
        add(new THREE.BoxGeometry(0.5, 0.45, 0.5), stone, side[0], 3.15, side[1]);
      }
    }
    for (const [x, z] of [
      [1.6, 1.6],
      [-1.6, 1.6],
      [1.6, -1.6],
      [-1.6, -1.6],
    ]) {
      add(new THREE.CylinderGeometry(0.55, 0.6, 3.4, 12), stone, x, 1.7, z);
      add(new THREE.ConeGeometry(0.72, 1.1, 12), roof, x, 3.95, z);
      add(new THREE.SphereGeometry(0.1, 8, 6), gold, x, 4.55, z);
    }
    // Cannon on top.
    const cannon = add(new THREE.CylinderGeometry(0.28, 0.36, 1.6, 12), mat({ color: '#9a6a2a', metalness: 0.6, roughness: 0.4 }), 0, 3.3, 0.35);
    cannon.rotation.x = Math.PI / 2 - 0.25;
    cannon.name = 'cannon';
    add(new THREE.BoxGeometry(0.9, 0.35, 0.9), mat({ color: '#5a3a1e' }), 0, 3.05, 0);
    // Banners and gate.
    for (const x of [-0.85, 0.85]) {
      const b = add(new THREE.PlaneGeometry(0.75, 1.5), bannerMat, x, 1.7, 1.72);
      b.rotation.y = 0;
    }
    add(new THREE.BoxGeometry(0.9, 1.2, 0.1), mat({ color: '#5a3a1e' }), 0, 0.6, 1.72);
    add(new THREE.TorusGeometry(0.45, 0.06, 6, 16, Math.PI), gold, 0, 1.2, 1.76);
  }
  const merged = mergeByMaterial(g);
  if (team === 1) merged.rotation.y = Math.PI;
  return { root: merged, mixer: null, actions: new Map(), materials, height: type === 'keep' ? 4.6 : 4.2 };
}
