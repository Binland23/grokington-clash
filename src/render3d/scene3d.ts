import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA_H, ARENA_W, RIVER_BOTTOM, RIVER_TOP, TOWER_SPOTS } from '../engine/arena';
import { DEPLOY_TIME, formationOffsets, type Battle, type Effect, type Projectile, type Unit } from '../engine/battle';
import { CARDS, UNITS } from '../engine/cards';
import { Rng } from '../engine/rng';
import type { Team, UnitStats } from '../engine/types';
import type { Fx } from '../render/fx';
import { getSprite } from '../render/sprites';
import type { ArenaTheme } from '../render/themes';
import { W, buildArena, type Arena3D } from './arena3d';
import { hasModel, instantiate, proceduralTower, type ModelInstance } from './models';
import { radialTexture, ringTexture, scorchTexture } from './textures';

export interface DeployPreview {
  cardId: string;
  x: number;
  y: number;
  ok: boolean;
  /** Where the finger actually is (client px), when the ghost is lifted above it. */
  finger?: { x: number; y: number };
}

export interface PowerPreview {
  x: number;
  y: number;
  radius: number;
  color: string;
}

const TEAM_HEX: Record<Team, { main: string; dark: string }> = {
  0: { main: '#3d8bff', dark: '#1d4fb8' },
  1: { main: '#ff4b55', dark: '#b51f2b' },
};
const FONT = '"Lilita One", "Arial Black", sans-serif';
const FLY_H = 1.9;
/** Troops are drawn larger than their footprint so they read clearly next to the towers. */
const TROOP_SCALE = 1.4;

/** Which 3D model represents a unit (sentinel reuses the brute). */
function modelKey(s: UnitStats): string {
  return s.id === 'sentinel' ? 'brute' : s.id;
}

interface UnitView {
  id: number;
  team: Team;
  s: UnitStats;
  structure: boolean;
  root: THREE.Group;
  body: THREE.Object3D;
  model: ModelInstance | null;
  sprite: THREE.Sprite | null;
  spriteMat: THREE.SpriteMaterial | null;
  shadow: THREE.Mesh;
  ring: THREE.Mesh | null;
  height: number;
  yaw: number;
  lastX: number;
  lastY: number;
  lastAttack: number;
  current: string;
  attackUntil: number;
  deathT: number;
  flipX: number;
  /** Hit reaction: knockback direction (world xz), peak offset, squash and elapsed/duration. */
  kickDx: number;
  kickDz: number;
  kickAmp: number;
  kickSquash: number;
  kickT: number;
  kickDur: number;
}

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  overlay: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  arena: Arena3D;
  time = 0;
  dpr = 1;
  Wpx = 1;
  Hpx = 1;
  pendingSmoke: { x: number; y: number }[] = [];
  private camBase = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private views = new Map<number, UnitView>();
  private dying: UnitView[] = [];
  private projs = new Map<number, THREE.Object3D>();
  private effects = new Map<number, THREE.Object3D>();
  private rubble = new Set<string>();
  private spriteTex = new Map<string, THREE.Texture>();
  private shadowTex = radialTexture([
    [0, 'rgba(0,0,0,0.55)'],
    [0.6, 'rgba(0,0,0,0.25)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  private ringTex = ringTexture();
  private glowTex = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(255,255,255,0.6)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private decalTex = { scorch: scorchTexture('scorch'), crater: scorchTexture('crater'), ice: scorchTexture('ice'), rubble: scorchTexture('crater') };
  private ringPool: THREE.Mesh[] = [];
  private glowPool: THREE.Sprite[] = [];
  private decalPool: THREE.Mesh[] = [];
  private pts: { add: THREE.Points; norm: THREE.Points };
  private colorCache = new Map<string, THREE.Color>();
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private previewGroup = new THREE.Group();
  private pvLine: { tx: number; ty: number; fx: number; fy: number; ok: boolean } | null = null;
  private zoneMeshes: THREE.Mesh[] = [];
  private ghostCache = new Map<string, THREE.Object3D>();
  private sun: THREE.DirectionalLight;
  private ambient: THREE.Points;
  private introT = 0;

  constructor(
    public canvas: HTMLCanvasElement,
    public theme: ArenaTheme,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(theme.outsideDark);
    this.scene.fog = new THREE.Fog(theme.outsideDark, 55, 95);

    // Soft image-based fill light so painted models read like their studio renders.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    const hemi = new THREE.HemisphereLight('#dbeeff', '#6a5a44', 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff1d8', 2.7);
    this.sun.position.set(-9, 22, 9);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    this.sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 20;
    sc.bottom = -20;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight('#b8d8ff', 0.6);
    rim.position.set(10, 8, -14);
    this.scene.add(rim);

    this.arena = buildArena(theme);
    this.scene.add(this.arena.group);
    this.scene.add(this.previewGroup);

    this.pts = { add: this.makePoints(true), norm: this.makePoints(false) };
    this.scene.add(this.pts.norm, this.pts.add);
    this.ambient = this.makeAmbient(theme);
    this.scene.add(this.ambient);

    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    canvas.parentElement?.appendChild(this.overlay);
    this.g = this.overlay.getContext('2d')!;
    this.resize();
  }

  dispose(): void {
    this.renderer.dispose();
    this.overlay.remove();
  }

  // ------------------------------------------------------------------ camera

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.Wpx = Math.max(1, r.width);
    this.Hpx = Math.max(1, r.height);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.Wpx, this.Hpx, false);
    this.overlay.width = Math.round(this.Wpx * this.dpr);
    this.overlay.height = Math.round(this.Hpx * this.dpr);
    this.camera.aspect = this.Wpx / this.Hpx;
    this.fitCamera();
  }

  /** Frame the whole arena (plus a little rim) at a fixed tilt, like a TV camera over the pitch. */
  private fitCamera(): void {
    const cam = this.camera;
    const tilt = THREE.MathUtils.degToRad(57);
    const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    const corners = [
      new THREE.Vector3(-ARENA_W / 2 - 0.5, 0, -ARENA_H / 2 - 0.6),
      new THREE.Vector3(ARENA_W / 2 + 0.5, 0, -ARENA_H / 2 - 0.6),
      new THREE.Vector3(-ARENA_W / 2 - 0.5, 0, ARENA_H / 2 + 0.6),
      new THREE.Vector3(ARENA_W / 2 + 0.5, 0, ARENA_H / 2 + 0.6),
      new THREE.Vector3(0, 4.6, -ARENA_H / 2 + 3),
    ];
    let target = new THREE.Vector3(0, 0, 0.6);
    let dist = 60;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 10;
      let hi = 160;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        cam.position.copy(target).addScaledVector(dir, mid);
        cam.lookAt(target);
        cam.updateMatrixWorld();
        cam.updateProjectionMatrix();
        const ok = corners.every((c) => {
          const p = c.clone().project(cam);
          return Math.abs(p.x) <= 0.985 && p.y <= 0.975 && p.y >= -0.985;
        });
        if (ok) hi = mid;
        else lo = mid;
      }
      dist = hi;
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      // Balance top/bottom margins by sliding the target along z.
      const top = corners[0].clone().project(cam).y;
      const bottom = corners[2].clone().project(cam).y;
      const off = (top + bottom) / 2;
      target = target.clone().add(new THREE.Vector3(0, 0, off * 4));
    }
    this.camTarget.copy(target);
    this.camBase.copy(cam.position);
    // Keep the fog out past the arena so only the far scenery fades.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist + 12;
    fog.far = dist + 70;
  }

  toTile(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return { x: -99, y: -99 };
    return { x: hit.x + ARENA_W / 2, y: hit.z + ARENA_H / 2 };
  }

  /** Shove a unit away from `from` and squash it: the visible half of a hit. `power` ~ 0.5 light .. 2 massive. */
  kick(id: number, fromX: number | undefined, fromY: number | undefined, power: number): void {
    const v = this.views.get(id);
    if (!v) return;
    let dx = fromX === undefined ? 0 : v.lastX - fromX;
    let dz = fromY === undefined ? 0 : v.lastY - fromY;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
    } else {
      dx /= len;
      dz /= len;
    }
    // Big bodies barely move; towers only shudder.
    const mass = v.structure ? 0 : 1 / (0.7 + v.s.radius);
    v.kickDx = dx;
    v.kickDz = dz;
    v.kickAmp = Math.min(0.7, 0.3 * power * mass);
    v.kickSquash = Math.min(0.28, (v.structure ? 0.03 : 0.13) * power);
    v.kickT = 0;
    v.kickDur = 0.14 + 0.06 * Math.min(2, power);
  }

  private project(x: number, y: number, h: number): { x: number; y: number; k: number; vis: boolean } {
    const p = W(x, y, h);
    const q = p.clone().project(this.camera);
    const p2 = W(x + 1, y, h).project(this.camera);
    const sx = ((q.x + 1) / 2) * this.Wpx;
    const sy = ((1 - q.y) / 2) * this.Hpx;
    const k = Math.abs(((p2.x + 1) / 2) * this.Wpx - sx);
    return { x: sx, y: sy, k, vis: q.z < 1 };
  }

  /** Start the opening camera sweep. */
  playIntro(): void {
    this.introT = 1.4;
  }

  /** Weather/atmosphere particles animated entirely in the vertex shader. */
  private makeAmbient(theme: ArenaTheme): THREE.Points {
    const kind = theme.id === 'frost' ? 'snow' : theme.id === 'ember' ? 'ember' : theme.id === 'swamp' || theme.id === 'necro' ? 'fly' : 'pollen';
    const N = kind === 'snow' ? 700 : 260;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const rng = new Rng(5);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rng.range(-14, 14);
      pos[i * 3 + 1] = rng.range(0, 12);
      pos[i * 3 + 2] = rng.range(-20, 20);
      seed[i] = rng.next();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const color = { snow: '#ffffff', ember: '#ffae4a', fly: theme.glow ?? '#e6ff7a', pollen: '#fffbe0' }[kind];
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: kind === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uColor: { value: new THREE.Color(color) }, uKind: { value: ['snow', 'ember', 'fly', 'pollen'].indexOf(kind) } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime, uScale, uKind;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.6 + seed * 0.6);
          if (uKind < 0.5) { // snow falls
            p.y = mod(p.y - t * 0.9, 12.0);
            p.x += sin(t * 0.8 + seed * 20.0) * 0.6;
          } else if (uKind < 1.5) { // embers rise
            p.y = mod(p.y + t * 0.8, 12.0);
            p.x += sin(t * 1.3 + seed * 10.0) * 0.4;
          } else { // fireflies / pollen drift
            p.x += sin(t * 0.5 + seed * 30.0) * 1.2;
            p.z += cos(t * 0.4 + seed * 17.0) * 1.2;
            p.y = 0.6 + mod(p.y, 5.0) + sin(t + seed * 9.0) * 0.4;
          }
          vA = uKind > 1.5 && uKind < 2.5 ? 0.35 + 0.65 * abs(sin(t * 2.0 + seed * 40.0)) : 0.85;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = uKind < 0.5 ? 0.12 : uKind < 1.5 ? 0.09 : 0.1;
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vA);
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  // ------------------------------------------------------------------ helpers

  private color(c: string): THREE.Color {
    let col = this.colorCache.get(c);
    if (!col) {
      col = new THREE.Color();
      try {
        col.setStyle(c.startsWith('rgba') ? c.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)') : c);
      } catch {
        col.set('#ffffff');
      }
      this.colorCache.set(c, col);
    }
    return col;
  }

  private spriteTexture(name: string, team: Team): THREE.Texture | null {
    const key = `${name}|${team}`;
    let t = this.spriteTex.get(key);
    if (t) return t;
    const spr = getSprite(name, team);
    if (!spr) return null;
    t = new THREE.Texture(spr.img as HTMLImageElement);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    t.anisotropy = 4;
    this.spriteTex.set(key, t);
    return t;
  }

  private makePoints(additive: boolean): THREE.Points {
    const N = 1000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color4', new THREE.BufferAttribute(new Float32Array(N * 4), 4));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec4 color4;
        attribute float size;
        varying vec4 vColor;
        uniform float uScale;
        void main() {
          vColor = color4;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.15, d) * vColor.a;
          gl_FragColor = vec4(vColor.rgb, a);
          #include <colorspace_fragment>
        }`,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    return p;
  }

  // ------------------------------------------------------------------ unit views

  private createView(u: Unit): UnitView {
    const root = new THREE.Group();
    const structure = u.isStructure;
    let model: ModelInstance | null = null;
    let sprite: THREE.Sprite | null = null;
    let spriteMat: THREE.SpriteMaterial | null = null;
    let body: THREE.Object3D;
    let height = u.s.height;
    const key = modelKey(u.s);
    if (u.kind === 'tower') {
      model = hasModel(key) ? instantiate(key, u.team, u.s.height, u.s.radius * 2 * 1.15) : proceduralTower(u.towerType!, u.team);
    } else if (hasModel(key)) {
      model = structure ? instantiate(key, u.team, u.s.height, u.s.radius * 2 * 1.2) : instantiate(key, u.team, u.s.height * TROOP_SCALE);
    }
    if (model) {
      body = model.root;
      height = model.height;
      if (u.kind === 'tower' && u.team === 1 && hasModel(key)) body.rotation.y = Math.PI;
    } else {
      const t = this.spriteTexture(u.s.sprite, u.team);
      spriteMat = new THREE.SpriteMaterial({ map: t, transparent: true, alphaTest: 0.05 });
      sprite = new THREE.Sprite(spriteMat);
      sprite.center.set(0.5, 0);
      const img = t?.image as HTMLImageElement | undefined;
      const aspect = img ? img.width / img.height : 0.7;
      const h = structure ? (u.s.radius * 2 * 1.25) / aspect : u.s.height * TROOP_SCALE;
      sprite.scale.set(h * aspect, h, 1);
      height = h;
      body = sprite;
    }
    root.add(body);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    const sr = u.s.radius * (structure ? 2.6 : 2.6);
    shadow.scale.set(sr, sr * 0.85, 1);
    shadow.position.y = 0.02;
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    let ring: THREE.Mesh | null = null;
    if (u.kind === 'troop') {
      ring = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.ringTex, color: TEAM_HEX[u.team].main, transparent: true, opacity: 0.6, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      const rs = u.s.radius * 2.3;
      ring.scale.set(rs, rs, 1);
      ring.position.y = 0.03;
      ring.renderOrder = 2;
      this.scene.add(ring);
    }
    this.scene.add(root);
    const v: UnitView = {
      id: u.id, team: u.team, s: u.s, structure, root, body, model, sprite, spriteMat, shadow, ring, height,
      yaw: u.team === 0 ? Math.PI : 0, lastX: u.x, lastY: u.y, lastAttack: 0, current: '', attackUntil: 0, deathT: 0,
      flipX: 1, kickDx: 0, kickDz: 0, kickAmp: 0, kickSquash: 0, kickT: 1, kickDur: 0.22,
    };
    if (model?.mixer) this.play(v, 'idle');
    return v;
  }

  private play(v: UnitView, name: string, once = false, duration?: number): void {
    const m = v.model;
    if (!m?.mixer) return;
    const a = m.actions.get(name) ?? (name === 'attack' ? m.actions.get('cast') ?? m.actions.get('shoot') : undefined);
    if (!a) return;
    if (v.current === name && !once) return;
    const prev = m.actions.get(v.current);
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    if (duration) a.timeScale = a.getClip().duration / duration;
    else a.timeScale = 1;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (prev && prev !== a) a.crossFadeFrom(prev, 0.12, false);
    a.play();
    v.current = name;
  }

  private removeView(v: UnitView): void {
    this.scene.remove(v.root, v.shadow);
    if (v.ring) this.scene.remove(v.ring);
  }

  private updateView(v: UnitView, u: Unit, dt: number): void {
    const p = W(u.x, u.y);
    const frozen = u.freezeT > 0;
    const disabled = frozen || u.stunT > 0;
    let elev = 0;
    if (u.flying) elev += FLY_H + Math.sin(this.time * 3 + u.id) * 0.1;
    if (u.hop) elev += 0.8 * Math.abs(Math.sin(this.time * 5));
    if (u.deployT > 0) elev += Math.pow(u.deployT / DEPLOY_TIME, 2) * 4;
    let kx = 0;
    let kz = 0;
    let ks = 0;
    if (v.kickT < v.kickDur) {
      v.kickT += dt;
      const t = Math.min(1, v.kickT / v.kickDur);
      const pulse = Math.sin(t * Math.PI);
      kx = v.kickDx * v.kickAmp * pulse;
      kz = v.kickDz * v.kickAmp * pulse;
      ks = v.kickSquash * (1 - t) * (1 - t);
    }
    v.root.position.set(p.x + kx, elev, p.z + kz);
    v.root.scale.set(1 + ks * 0.7, 1 - ks, 1 + ks * 0.7);
    v.shadow.position.set(p.x, 0.02, p.z);
    const shrink = u.flying ? 0.7 : u.deployT > 0 ? 1 - (u.deployT / DEPLOY_TIME) * 0.6 : 1;
    const sr = u.s.radius * 2.6 * shrink;
    v.shadow.scale.set(sr, sr * 0.85, 1);
    if (v.ring) {
      v.ring.position.set(p.x, 0.03, p.z);
      (v.ring.material as THREE.MeshBasicMaterial).opacity = u.rageT > 0 ? 0.9 : 0.55;
      (v.ring.material as THREE.MeshBasicMaterial).color.set(u.rageT > 0 ? '#d36bff' : TEAM_HEX[u.team].main);
    }

    // Facing: toward travel, or toward the target while fighting.
    const dx = u.x - v.lastX;
    const dy = u.y - v.lastY;
    let want = v.yaw;
    if (u.inRange && u.target) want = Math.atan2(u.target.x - u.x, u.target.y - u.y);
    else if (dx * dx + dy * dy > 1e-6) want = Math.atan2(dx, dy);
    v.lastX = u.x;
    v.lastY = u.y;
    if (!v.structure) {
      let diff = want - v.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.yaw += diff * Math.min(1, dt * 10);
    }

    const attacked = u.attackAnim > v.lastAttack + 0.01;
    v.lastAttack = u.attackAnim;
    const flash = u.flash > 0 ? u.flash / 0.12 : 0;

    if (v.model) {
      if (!v.structure) v.root.rotation.y = v.yaw;
      const mixer = v.model.mixer;
      if (mixer) {
        mixer.timeScale = disabled ? 0 : u.rageT > 0 ? u.rageMul : 1;
        if (attacked) {
          const dur = Math.min(0.9 * u.s.hitSpeed, 0.75);
          this.play(v, 'attack', true, dur);
          v.attackUntil = this.time + dur;
        } else if (this.time >= v.attackUntil) {
          this.play(v, u.moving ? 'walk' : 'idle');
          const walk = v.model.actions.get('walk');
          if (walk && v.current === 'walk') walk.timeScale = Math.max(0.6, u.s.speed * (u.charging ? 2 : 1)) * 0.9;
        }
        mixer.update(dt);
      } else {
        // Static model: procedural squash & bob.
        this.proceduralPose(v, u, attacked);
      }
      for (const m of v.model.materials) {
        m.emissive.setRGB(flash * 0.9 + (frozen ? 0.15 : 0), flash * 0.9 + (frozen ? 0.35 : 0), flash * 0.9 + (frozen ? 0.55 : 0));
      }
      if (u.kind === 'tower' && u.target) {
        const cannon = v.body.getObjectByName('cannon');
        if (cannon) cannon.parent!.rotation.y = 0;
      }
    } else if (v.sprite && v.spriteMat) {
      this.proceduralPose(v, u, attacked);
      const c = v.spriteMat.color;
      if (frozen) c.setRGB(0.65, 0.95, 1.35);
      else c.setRGB(1 + flash * 2.2, 1 + flash * 2.2, 1 + flash * 2.2);
      v.spriteMat.opacity = u.deployT > 0 ? 0.55 + 0.45 * (1 - u.deployT / DEPLOY_TIME) : 1;
    }
    if (u.kind === 'tower' && u.hp < u.maxHp * 0.35 && Math.random() < 0.08) {
      this.pendingSmoke.push({ x: u.x + (Math.random() - 0.5) * u.s.radius, y: u.y });
    }
  }

  /** Squash/stretch, bobbing and lunges for sprites and unrigged models. */
  private proceduralPose(v: UnitView, u: Unit, attacked: boolean): void {
    void attacked;
    const frozen = u.freezeT > 0;
    let bob = 0;
    let sx = 1;
    let sy = 1;
    if (!frozen && u.kind === 'troop') {
      if (u.moving) {
        bob = Math.abs(Math.sin(u.walkT * 7)) * 0.1;
        sy = 1 + Math.sin(u.walkT * 14) * 0.04;
        sx = 1 - Math.sin(u.walkT * 14) * 0.025;
      } else sy = 1 + Math.sin(this.time * 2.4 + u.id) * 0.02;
    }
    let lunge = 0;
    if (u.attackAnim > 0 && !frozen) {
      const k = Math.sin((1 - u.attackAnim / 0.28) * Math.PI);
      lunge = (u.s.projectile ? -0.08 : 0.25) * k;
      sx *= 1 + 0.07 * k;
      sy *= 1 - 0.05 * k;
    }
    if (v.sprite) {
      // Flip the billboard toward the direction of travel on screen.
      const sdx = Math.sin(v.yaw);
      if (Math.abs(sdx) > 0.3) v.flipX = sdx > 0 ? 1 : -1;
      const base = v.sprite.userData.base ?? (v.sprite.userData.base = v.sprite.scale.clone());
      v.sprite.scale.set(base.x * sx * (v.structure ? 1 : v.flipX), base.y * sy, 1);
      v.sprite.position.set(Math.sin(v.yaw) * lunge, bob, Math.cos(v.yaw) * lunge);
    } else if (v.model) {
      v.body.scale.set(sx, sy, sx);
      v.body.position.set(0, bob, lunge);
    }
  }

  private updateDying(v: UnitView, dt: number): boolean {
    v.deathT += dt;
    const t = v.deathT;
    if (v.s.id === 'keep' || v.s.id === 'watch') {
      // Towers crumble: shudder, tilt and sink into the rubble.
      const k = Math.min(1, t / 1.1);
      v.body.position.set((Math.random() - 0.5) * 0.12 * (1 - k), -k * k * v.height * 0.9, 0);
      v.body.rotation.z = Math.sin(t * 9) * 0.04 * (1 - k) + k * 0.12;
      v.body.rotation.x = k * 0.08;
      (v.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      return t < 1.2;
    }
    if (v.model?.mixer && v.model.actions.has('death')) {
      if (v.current !== 'death') this.play(v, 'death', true, 0.7);
      v.model.mixer.update(dt);
      if (t > 0.9) v.root.position.y -= dt * 1.5;
    } else if (v.model) {
      v.root.rotation.x = Math.min(Math.PI / 2, t * 5) * -1;
      v.root.position.y -= dt * (t > 0.3 ? 2 : 0);
    } else if (v.sprite && v.spriteMat) {
      const base = v.sprite.userData.base as THREE.Vector3 | undefined;
      if (base) v.sprite.scale.set(base.x * (1 + t), base.y * Math.max(0.05, 1 - t * 2), 1);
      v.spriteMat.opacity = Math.max(0, 1 - t * 2);
      v.spriteMat.color.setRGB(3, 3, 3);
    }
    const fade = Math.max(0, 1 - t / 1.1);
    (v.shadow.material as THREE.MeshBasicMaterial).opacity = fade;
    if (v.ring) (v.ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.5;
    return t < 1.2;
  }

  // ------------------------------------------------------------------ frame

  render(b: Battle, fx: Fx, dt: number, preview: DeployPreview | null, power: PowerPreview | null): void {
    this.time += dt;
    this.arena.update(this.time);

    // Units.
    const alive = new Set<number>();
    for (const u of b.units) {
      alive.add(u.id);
      let v = this.views.get(u.id);
      if (!v) {
        v = this.createView(u);
        this.views.set(u.id, v);
      }
      this.updateView(v, u, dt);
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      this.views.delete(id);
      this.dying.push(v);
    }
    this.dying = this.dying.filter((v) => {
      const keep = this.updateDying(v, dt);
      if (!keep) this.removeView(v);
      return keep;
    });
    this.updateRubble(b);
    this.updateProjectiles(b, fx);
    this.updateEffects(b.effects);
    this.updateFx(fx);
    this.updatePreview(b, preview, power);

    // Camera: opening sweep, then shake.
    const shake = fx.shake;
    this.camera.position.copy(this.camBase);
    if (this.introT > 0) {
      this.introT = Math.max(0, this.introT - dt);
      const k = this.introT / 1.4;
      const e = k * k * (3 - 2 * k);
      const rel = this.camBase.clone().sub(this.camTarget);
      rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), e * 0.45);
      rel.multiplyScalar(1 + e * 0.18);
      rel.y += e * 3;
      this.camera.position.copy(this.camTarget).add(rel);
    }
    if (fx.punch > 0) {
      const dir = this.camTarget.clone().sub(this.camera.position).normalize();
      this.camera.position.addScaledVector(dir, fx.punch * 0.9);
    }
    if (shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * shake * 0.9;
      this.camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    }
    this.camera.lookAt(this.camTarget.x + (this.camera.position.x - this.camBase.x) * 0.5, this.camTarget.y, this.camTarget.z);

    const am = this.ambient.material as THREE.ShaderMaterial;
    am.uniforms.uTime.value = this.time;
    am.uniforms.uScale.value = (this.Hpx * this.dpr * this.camera.projectionMatrix.elements[5]) / 2;
    (this.pts.add.material as THREE.ShaderMaterial).uniforms.uScale.value = (this.Hpx * this.dpr * this.camera.projectionMatrix.elements[5]) / 2;
    (this.pts.norm.material as THREE.ShaderMaterial).uniforms.uScale.value = (this.Hpx * this.dpr * this.camera.projectionMatrix.elements[5]) / 2;
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(b, fx);
  }

  private updateRubble(b: Battle): void {
    for (const s of TOWER_SPOTS) {
      const key = `${s.team}${s.type}${s.lane}`;
      if (this.rubble.has(key)) continue;
      const alive = b.units.some((u) => u.kind === 'tower' && u.team === s.team && u.towerType === s.type && u.lane === s.lane);
      if (alive) continue;
      this.rubble.add(key);
      const g = new THREE.Group();
      const rng = new Rng(Math.round(s.x * 100 + s.y));
      const stone = new THREE.MeshStandardMaterial({ color: '#a39d92', roughness: 0.95, flatShading: true });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(s.radius * 0.95, s.radius * 1.05, 0.6, 10, 1, true), stone);
      base.position.y = 0.3;
      base.castShadow = true;
      g.add(base);
      for (let i = 0; i < 16; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rng.range(0.18, 0.45), 0), stone);
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0, s.radius * 1.2);
        r.position.set(Math.cos(a) * d, rng.range(0.1, 0.5), Math.sin(a) * d);
        r.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
        r.castShadow = true;
        g.add(r);
      }
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshStandardMaterial({ color: TEAM_HEX[s.team].dark, side: THREE.DoubleSide }));
      flag.position.set(0.3, 0.12, 0.6);
      flag.rotation.x = -Math.PI / 2.3;
      g.add(flag);
      g.position.copy(W(s.x, s.y));
      this.scene.add(g);
    }
  }

  private projMesh(p: Projectile): THREE.Object3D {
    const g = new THREE.Group();
    const kind = p.spell ? (p.spell.stats.fx === 'arrows' ? 'volley' : 'orb') : p.kind;
    const addGlow = (color: string, size: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(size);
      g.add(s);
    };
    switch (kind) {
      case 'arrow':
      case 'bolt': {
        const len = kind === 'bolt' ? 0.9 : 0.6;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), new THREE.MeshStandardMaterial({ color: '#6b4522' }));
        shaft.rotation.x = Math.PI / 2;
        g.add(shaft);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), new THREE.MeshStandardMaterial({ color: '#d9dde3', metalness: 0.8, roughness: 0.3 }));
        tip.rotation.x = Math.PI / 2;
        tip.position.z = len / 2 + 0.06;
        g.add(tip);
        const fl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.14), new THREE.MeshStandardMaterial({ color: TEAM_HEX[p.team].main }));
        fl.position.z = -len / 2 + 0.06;
        g.add(fl);
        break;
      }
      case 'bullet':
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff2a0' })));
        addGlow('#ffd27a', 0.5);
        break;
      case 'cannon':
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshStandardMaterial({ color: '#25282e', metalness: 0.6, roughness: 0.4 })));
        break;
      case 'fire':
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe08a' })));
        addGlow('#ff8a2a', 1.1);
        break;
      case 'orb':
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff0b0' })));
        addGlow('#ff7a1a', 2.6);
        addGlow('#ffd27a', 1.4);
        break;
      case 'volley': {
        const mat = new THREE.MeshStandardMaterial({ color: '#6b4522' });
        for (let i = 0; i < 9; i++) {
          const a = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4), mat);
          a.rotation.x = Math.PI / 2;
          a.position.set(((i % 3) - 1) * 0.35, (Math.floor(i / 3) - 1) * 0.2, -Math.floor(i / 3) * 0.25);
          g.add(a);
        }
        break;
      }
      default:
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' })));
    }
    this.scene.add(g);
    return g;
  }

  private updateProjectiles(b: Battle, fx: Fx): void {
    const seen = new Set<number>();
    const arcs: Record<string, number> = { cannon: 1.6, fire: 0.7, arrow: 0.6, bolt: 0.2, bullet: 0, bomb: 0, spark: 0, stone: 1 };
    for (const p of b.projectiles) {
      seen.add(p.id);
      let m = this.projs.get(p.id);
      if (!m) {
        m = this.projMesh(p);
        this.projs.set(p.id, m);
      }
      let arc = arcs[p.kind] ?? 0;
      if (p.spell) arc = p.spell.stats.fx === 'arrows' ? 4 : 5;
      const prog = p.progress;
      const z = p.z0 * (1 - prog) + arc * Math.sin(prog * Math.PI);
      const pos = W(p.x, p.y, z);
      const ahead = Math.min(1, prog + 0.05);
      const z2 = p.z0 * (1 - ahead) + arc * Math.sin(ahead * Math.PI);
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const look = W(p.x + (dx / d) * 0.3, p.y + (dy / d) * 0.3, z + (z2 - z));
      m.position.copy(pos);
      m.lookAt(look);
      if ((p.kind === 'fire' || p.spell?.stats.fx === 'fire') && Math.random() < 0.8) {
        fx.burst(p.x, p.y, 1, { kind: 'ember', z, colors: ['#ffb347', '#ff6a2a', '#ffd27a'], speed: 0.5, up: 0.4, gravity: -0.5, max: 0.45, size: p.spell ? 0.35 : 0.16 });
      }
    }
    for (const [id, m] of this.projs) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.projs.delete(id);
    }
  }

  private updateEffects(list: Effect[]): void {
    const seen = new Set<number>();
    for (const e of list) {
      seen.add(e.id);
      let m = this.effects.get(e.id);
      if (!m) {
        m = new THREE.Group();
        const col = e.kind === 'rage' ? '#c85cff' : e.kind === 'heal' ? '#8aff7a' : '#ff5a2a';
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.05;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        m.add(disc, ring);
        if (e.kind === 'meteor') {
          const rock = new THREE.Group();
          rock.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: '#4a2a1a', emissive: '#ff4a10', emissiveIntensity: 0.6, flatShading: true })));
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ff7a2a', blending: THREE.AdditiveBlending, depthWrite: false }));
          glow.scale.setScalar(3.5);
          rock.add(glow);
          rock.name = 'rock';
          m.add(rock);
        }
        m.position.copy(W(e.x, e.y));
        m.scale.setScalar(1);
        this.scene.add(m);
        this.effects.set(e.id, m);
      }
      const disc = m.children[0] as THREE.Mesh;
      const ring = m.children[1] as THREE.Mesh;
      disc.scale.setScalar(e.radius);
      const pulse = 0.9 + 0.1 * Math.sin(this.time * 6);
      ring.scale.setScalar(e.radius * pulse);
      const fade = e.kind === 'meteor' ? 1 : Math.min(1, (e.duration - e.t) * 2) * Math.min(1, e.t * 6);
      (disc.material as THREE.MeshBasicMaterial).opacity = 0.2 * fade;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;
      const rock = m.getObjectByName('rock');
      if (rock) {
        const p = Math.min(1, e.t / e.duration);
        rock.position.set((1 - p) * 4, (1 - p) * 16, -(1 - p) * 3);
        rock.rotation.x += 0.2;
        rock.rotation.z += 0.13;
      }
    }
    for (const [id, m] of this.effects) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.effects.delete(id);
    }
  }

  private updateFx(fx: Fx): void {
    // Particles.
    const fill = (pts: THREE.Points, filter: (k: string) => boolean) => {
      const geo = pts.geometry;
      const pos = geo.attributes.position.array as Float32Array;
      const col = geo.attributes.color4.array as Float32Array;
      const size = geo.attributes.size.array as Float32Array;
      let n = 0;
      for (const p of fx.particles) {
        if (!filter(p.kind) || n >= 1000) continue;
        const a = Math.max(0, p.life / p.max);
        pos[n * 3] = p.x - ARENA_W / 2;
        pos[n * 3 + 1] = p.z;
        pos[n * 3 + 2] = p.y - ARENA_H / 2;
        const c = this.color(p.color);
        col[n * 4] = c.r;
        col[n * 4 + 1] = c.g;
        col[n * 4 + 2] = c.b;
        const kindAlpha = p.kind === 'smoke' ? 0.6 : p.kind === 'dust' ? 0.5 : 1;
        col[n * 4 + 3] = (p.kind === 'debris' ? Math.min(1, a * 2) : a) * kindAlpha;
        size[n] = p.size * (p.kind === 'smoke' || p.kind === 'dust' ? 2.6 : p.kind === 'debris' ? 1.6 : 2.2) * (p.kind === 'spark' || p.kind === 'ember' ? 0.5 + a * 0.5 : 1);
        n++;
      }
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color4.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
    };
    fill(this.pts.add, (k) => k === 'spark' || k === 'ember' || k === 'heal' || k === 'star' || k === 'snow');
    fill(this.pts.norm, (k) => k === 'smoke' || k === 'dust' || k === 'debris');

    // Shockwave rings.
    while (this.ringPool.length < fx.rings.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 56), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 3;
      const fillM = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      fillM.position.z = -0.001;
      m.add(fillM);
      this.scene.add(m);
      this.ringPool.push(m);
    }
    this.ringPool.forEach((m, i) => {
      const r = fx.rings[i];
      m.visible = !!r;
      if (!r) return;
      const p = 1 - r.life / r.max;
      const e = 1 - Math.pow(1 - p, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      m.position.copy(W(r.x, r.y, 0.08));
      m.scale.set(rad, rad, 1);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.copy(this.color(r.color));
      mat.opacity = (1 - p) * 0.95;
      const fm = (m.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      fm.visible = !!r.fill;
      if (r.fill) {
        fm.color.copy(this.color(r.fill));
        fm.opacity = (1 - p) * 0.3;
      }
    });

    // Light bursts.
    while (this.glowPool.length < fx.glows.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.renderOrder = 5;
      this.scene.add(sp);
      this.glowPool.push(sp);
    }
    this.glowPool.forEach((sp, i) => {
      const gl = fx.glows[i];
      sp.visible = !!gl;
      if (!gl) return;
      const p = 1 - gl.life / gl.max;
      const mat = sp.material as THREE.SpriteMaterial;
      mat.color.copy(this.color(gl.color));
      mat.opacity = (1 - p) * (1 - p);
      sp.scale.setScalar(gl.size * (0.6 + p * 0.8));
      sp.position.copy(W(gl.x, gl.y, gl.h));
    });

    // Ground decals.
    while (this.decalPool.length < fx.decals.length) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.scene.add(m);
      this.decalPool.push(m);
    }
    this.decalPool.forEach((m, i) => {
      const d = fx.decals[i];
      m.visible = !!d;
      if (!d) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      const t = this.decalTex[d.kind];
      if (mat.map !== t) {
        mat.map = t;
        mat.needsUpdate = true;
      }
      mat.opacity = Math.min(1, d.life / Math.min(1.2, d.max)) * (d.kind === 'ice' ? 0.85 : 0.75);
      m.position.copy(W(d.x, d.y, 0.025 + i * 0.0005));
      m.scale.set(d.r, d.r, 1);
      m.rotation.z = d.seed;
    });
  }

  private ghostFor(cardId: string): THREE.Object3D {
    let g = this.ghostCache.get(cardId);
    if (g) return g;
    g = new THREE.Group();
    const card = CARDS[cardId];
    const stats = UNITS[card.unit!];
    const offs = formationOffsets(card.formation ?? 'single', card.count ?? 1);
    for (const o of offs) {
      const holder = new THREE.Group();
      holder.position.set(o.x, 0, o.y);
      const base = new THREE.Mesh(new THREE.CircleGeometry(stats.radius * 1.1, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
      base.rotation.x = -Math.PI / 2;
      base.position.y = 0.04;
      base.name = 'base';
      holder.add(base);
      const key = modelKey(stats);
      const inst = hasModel(key) ? instantiate(key, 0, stats.height * (stats.isBuilding ? 1 : TROOP_SCALE), stats.isBuilding ? stats.radius * 2 * 1.2 : undefined) : null;
      if (inst) {
        for (const m of inst.materials) {
          m.transparent = true;
          m.opacity = 0.5;
          m.depthWrite = false;
        }
        inst.root.rotation.y = Math.PI;
        inst.root.position.y = stats.flying ? FLY_H : 0;
        holder.add(inst.root);
      } else {
        const t = this.spriteTexture(stats.sprite, 0);
        if (t) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, opacity: 0.55, depthWrite: false }));
          s.center.set(0.5, 0);
          const img = t.image as HTMLImageElement;
          const aspect = img.width / img.height;
          const h = stats.isBuilding ? (stats.radius * 2 * 1.25) / aspect : stats.height * TROOP_SCALE;
          s.scale.set(h * aspect, h, 1);
          s.position.y = stats.flying ? FLY_H : 0;
          holder.add(s);
        }
      }
      g.add(holder);
    }
    if (stats.isBuilding && stats.range >= 2) {
      const r = new THREE.Mesh(new THREE.RingGeometry(stats.range + stats.radius - 0.05, stats.range + stats.radius, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.05;
      g.add(r);
    }
    this.ghostCache.set(cardId, g);
    return g;
  }

  private circle(color: string, radius: number, ok = true): THREE.Group {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 56), new THREE.MeshBasicMaterial({ color: ok ? color : '#ff4040', transparent: true, opacity: 0.22, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.06;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 72), new THREE.MeshBasicMaterial({ color: ok ? color : '#ff4040', transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    g.add(disc, ring);
    return g;
  }

  /** Tile marker + light pillar so a lifted ghost reads clearly from the target tile. */
  private pad(color: string, radius: number): THREE.Group {
    const g = new THREE.Group();
    const pulse = 1 + 0.06 * Math.sin(this.time * 8);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.88, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.scale.setScalar(pulse);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.88, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.07;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, 3.2, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 1.6;
    g.add(ring, disc, beam);
    return g;
  }

  private updatePreview(b: Battle, pv: DeployPreview | null, power: PowerPreview | null): void {
    this.previewGroup.clear();
    this.pvLine = pv?.finger ? { tx: pv.x, ty: pv.y, fx: pv.finger.x, fy: pv.finger.y, ok: pv.ok } : null;
    for (const z of this.zoneMeshes) z.visible = false;
    if (pv) {
      const card = CARDS[pv.cardId];
      if (card.type === 'spell') {
        const c = this.circle('#ffffff', card.spell!.radius, pv.ok);
        c.position.copy(W(pv.x, pv.y));
        this.previewGroup.add(c);
      } else {
        this.drawZone(b);
        if (pv.finger) {
          const pad = this.pad(pv.ok ? '#ffffff' : '#ff4040', UNITS[card.unit!].radius * 1.5 + 0.3);
          pad.position.copy(W(pv.x, pv.y));
          this.previewGroup.add(pad);
        }
        const gh = this.ghostFor(pv.cardId);
        gh.position.copy(W(pv.x, pv.y));
        gh.traverse((o) => {
          if (o.name === 'base') ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(pv.ok ? '#ffffff' : '#ff4040');
        });
        this.previewGroup.add(gh);
      }
    }
    if (power) {
      const c = this.circle(power.color, power.radius);
      c.position.copy(W(power.x, power.y));
      this.previewGroup.add(c);
    }
  }

  private drawZone(b: Battle): void {
    if (!this.zoneMeshes.length) {
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.22, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 4;
        this.scene.add(m);
        this.zoneMeshes.push(m);
      }
    }
    const pocket = (lane: -1 | 1) => {
      const t = b.tower(1, 'watch', lane);
      return !t || t.dead;
    };
    const lt = pocket(-1) ? 10 : RIVER_BOTTOM;
    const rt = pocket(1) ? 10 : RIVER_BOTTOM;
    const set = (m: THREE.Mesh, x0: number, y0: number, x1: number, y1: number) => {
      m.visible = y1 > y0;
      m.scale.set(x1 - x0, y1 - y0, 1);
      m.position.copy(W((x0 + x1) / 2, (y0 + y1) / 2, 0.09));
    };
    set(this.zoneMeshes[0], 0, 0, 9, lt);
    set(this.zoneMeshes[1], 9, 0, 18, rt);
    set(this.zoneMeshes[2], 0, RIVER_TOP, 9, pocket(-1) ? RIVER_BOTTOM : RIVER_TOP);
    set(this.zoneMeshes[3], 9, RIVER_TOP, 18, pocket(1) ? RIVER_BOTTOM : RIVER_TOP);
  }

  // ------------------------------------------------------------------ 2D overlay

  private drawOverlay(b: Battle, fx: Fx): void {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.Wpx, this.Hpx);
    // Lightning.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const bolt of fx.bolts) {
      const a = bolt.life / bolt.max;
      const pts = bolt.pts.map((p) => this.project(p.x, p.y, p.h ?? 0));
      const k = pts[pts.length - 1].k;
      for (const [w, col] of [
        [bolt.width * 2.6, 'rgba(160,220,255,0.35)'],
        [bolt.width, bolt.color],
        [bolt.width * 0.4, '#ffffff'],
      ] as [number, string][]) {
        g.globalAlpha = a;
        g.strokeStyle = col;
        g.lineWidth = Math.max(1, w * k);
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    for (const u of b.units) this.drawBars(u);
    this.drawFingerLine();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of fx.texts) {
      const p = 1 - t.life / t.max;
      const pr = this.project(t.x, t.y, 1.4);
      const scale = p < 0.15 ? 0.6 + (p / 0.15) * 0.5 : 1.1 - Math.min(0.1, (p - 0.15) * 0.3);
      g.globalAlpha = Math.min(1, t.life * 3);
      g.font = `${Math.round(t.size * pr.k * scale)}px ${FONT}`;
      g.lineWidth = Math.max(2, pr.k * 0.14);
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(t.text, pr.x, pr.y);
      g.fillStyle = t.color;
      g.fillText(t.text, pr.x, pr.y);
    }
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';
    if (fx.flash > 0) {
      g.globalAlpha = Math.min(0.6, fx.flash);
      g.fillStyle = fx.flashColor;
      g.fillRect(0, 0, this.Wpx, this.Hpx);
      g.globalAlpha = 1;
    }
  }

  /** Dashed tether from the fingertip up to the lifted placement. */
  private drawFingerLine(): void {
    const l = this.pvLine;
    if (!l) return;
    const g = this.g;
    const r = this.canvas.getBoundingClientRect();
    const f = { x: l.fx - r.left, y: l.fy - r.top };
    const t = this.project(l.tx, l.ty, 0);
    const col = l.ok ? '255,255,255' : '255,64,64';
    g.save();
    g.lineCap = 'round';
    g.setLineDash([2, 9]);
    g.lineWidth = 4;
    g.strokeStyle = `rgba(${col},0.75)`;
    g.beginPath();
    g.moveTo(f.x, f.y);
    g.lineTo(t.x, t.y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = `rgba(${col},0.35)`;
    g.strokeStyle = `rgba(${col},0.9)`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(f.x, f.y, 16, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawBars(u: Unit): void {
    if (u.dead) return;
    const isTower = u.kind === 'tower';
    if (!isTower && u.hp >= u.maxHp && u.kind === 'troop') return;
    const v = this.views.get(u.id);
    const h = (v?.height ?? u.s.height) + (u.flying ? FLY_H : 0) + 0.3;
    const pr = this.project(u.x, u.y, isTower ? h - 0.2 : h);
    const g = this.g;
    const col = TEAM_HEX[u.team];
    const frac = Math.max(0, u.hp / u.maxHp);
    const S = pr.k;
    if (isTower) {
      const w = (u.towerType === 'keep' ? 3 : 2.5) * S;
      const bh = Math.max(9, S * 0.42);
      const x = pr.x;
      const top = u.team === 0 ? this.project(u.x, u.y + u.s.radius + 0.4, 0).y : Math.max(2, pr.y - bh);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      rr(g, x - w / 2 - 2, top - 2, w + 4, bh + 4, bh * 0.45);
      g.fill();
      g.fillStyle = col.dark;
      rr(g, x - w / 2, top, w, bh, bh * 0.4);
      g.fill();
      g.fillStyle = col.main;
      rr(g, x - w / 2, top, Math.max(bh * 0.8, w * frac), bh, bh * 0.4);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x - w / 2 + 3, top + 2, Math.max(0, w * frac - 6), bh * 0.3);
      g.font = `${Math.round(bh * 0.95)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      const txt = String(Math.ceil(u.hp));
      g.strokeText(txt, x + bh * 0.4, top + bh / 2 + 1);
      g.fillStyle = '#fff';
      g.fillText(txt, x + bh * 0.4, top + bh / 2 + 1);
      const bx = x - w / 2 - bh * 0.25;
      g.fillStyle = col.dark;
      g.beginPath();
      g.arc(bx, top + bh / 2, bh * 0.75, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `${Math.round(bh * 0.85)}px ${FONT}`;
      g.fillText(String(u.level), bx, top + bh / 2 + 1);
      if (u.towerType === 'keep' && !u.active) {
        g.font = `${Math.round(S * 0.6)}px ${FONT}`;
        g.fillStyle = 'rgba(255,255,255,0.9)';
        const zz = this.project(u.x + 1.2, u.y, 5.2 + Math.sin(this.time * 2) * 0.2);
        g.fillText('z z', zz.x, zz.y);
      }
      g.textBaseline = 'alphabetic';
      return;
    }
    const w = Math.min(1.6, Math.max(0.9, u.s.radius * 2.4)) * S;
    const bh = Math.max(4, S * 0.17);
    const top = pr.y;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(pr.x - w / 2 - 1, top - 1, w + 2, bh + 2);
    g.fillStyle = col.dark;
    g.fillRect(pr.x - w / 2, top, w, bh);
    g.fillStyle = col.main;
    g.fillRect(pr.x - w / 2, top, w * frac, bh);
    if (u.stunT > 0) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i * Math.PI * 2) / 3;
        g.fillStyle = '#ffe14a';
        g.beginPath();
        g.arc(pr.x + Math.cos(a) * S * 0.35, top - S * 0.25 + Math.sin(a) * S * 0.12, S * 0.09, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}
