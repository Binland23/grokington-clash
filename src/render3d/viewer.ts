import * as THREE from 'three';
import type { UnitStats } from '../engine/types';
import { hasModel, instantiate, proceduralTower, type ModelInstance } from './models';

/**
 * Small turntable viewer used in the card detail screen: the unit's 3D model slowly spins
 * and cycles through its animations. Returns a cleanup function.
 */
export function mountViewer(host: HTMLElement, stats: UnitStats): () => void {
  const key = stats.id === 'sentinel' ? 'brute' : stats.id;
  const isTower = stats.id === 'keep' || stats.id === 'watch';
  if (!hasModel(key) && !isTower) return () => undefined;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e8f2ff', '#5a4a3a', 1.6));
  const key1 = new THREE.DirectionalLight('#fff1d8', 2.6);
  key1.position.set(3, 5, 4);
  scene.add(key1);
  const rim = new THREE.DirectionalLight('#9cc6ff', 1.4);
  rim.position.set(-4, 3, -4);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  let inst: ModelInstance | null = isTower && !hasModel(key) ? proceduralTower(stats.id as 'keep' | 'watch', 0) : instantiate(key, 0, 1);
  if (!inst) return () => undefined;
  const pivot = new THREE.Group();
  pivot.add(inst.root);
  scene.add(pivot);
  const box = new THREE.Box3().setFromObject(inst.root);
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, size.x * 0.9);
  const center = box.getCenter(new THREE.Vector3());
  camera.position.set(0, center.y + h * 0.35, h * 2.6);
  camera.lookAt(0, center.y, 0);
  // Ground disc.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.max(size.x, size.z) * 0.75, 48), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.002;
  scene.add(disc);

  const cycle = ['idle', 'walk', 'attack', 'idle', 'attack'].filter((n) => inst!.actions.has(n));
  let ci = 0;
  let current: THREE.AnimationAction | null = null;
  const next = () => {
    if (!inst?.mixer || !cycle.length) return;
    const a = inst.actions.get(cycle[ci % cycle.length])!;
    ci++;
    a.reset();
    a.setLoop(THREE.LoopRepeat, Infinity);
    if (current && current !== a) a.crossFadeFrom(current, 0.2, false);
    a.play();
    current = a;
  };
  next();
  let switchT = 2.2;
  let raf = 0;
  let last = performance.now();
  let alive = true;
  const frame = (t: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const hh = Math.max(1, r.height);
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
      renderer.setSize(w, hh, false);
      camera.aspect = w / hh;
      camera.updateProjectionMatrix();
    }
    pivot.rotation.y += dt * 0.6;
    inst?.mixer?.update(dt);
    switchT -= dt;
    if (switchT <= 0) {
      switchT = 2.2;
      next();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    renderer.dispose();
    canvas.remove();
    inst = null;
  };
}
