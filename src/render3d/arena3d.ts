import * as THREE from 'three';
import { ARENA_H, ARENA_W, BRIDGES, BRIDGE_HALF, RIVER_BOTTOM, RIVER_TOP } from '../engine/arena';
import { Rng } from '../engine/rng';
import type { ArenaTheme } from '../render/themes';
import { mergeByMaterial } from './models';
import { arenaFloorTexture, brickTexture, noiseTexture, plankTexture } from './textures';

/** Tile (x, y) to world. The arena is centred on the origin, 1 tile = 1 world unit, +Z toward the player. */
export function W(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x - ARENA_W / 2, h, y - ARENA_H / 2);
}

export const RIVER_DEPTH = 0.42;

export interface Arena3D {
  group: THREE.Group;
  update(t: number): void;
}

export function buildArena(theme: ArenaTheme): Arena3D {
  const group = new THREE.Group();
  const floorTex = arenaFloorTexture(theme);

  // Two floor slabs (enemy half, our half) leaving a trough for the river.
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0 });
  const slab = (y0: number, y1: number) => {
    const g = new THREE.PlaneGeometry(ARENA_W, y1 - y0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const v = uv.getY(i);
      // v=1 is the top edge (y0); the canvas texture has tile y=0 at v=1.
      const tileY = v > 0.5 ? y0 : y1;
      uv.setY(i, 1 - tileY / ARENA_H);
    }
    uv.needsUpdate = true;
    const m = new THREE.Mesh(g, floorMat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(W(ARENA_W / 2, (y0 + y1) / 2));
    m.receiveShadow = true;
    return m;
  };
  group.add(slab(0, RIVER_TOP), slab(RIVER_BOTTOM, ARENA_H));

  // River bed + banks.
  const bankMat = new THREE.MeshStandardMaterial({ map: noiseTexture(theme.bank, 'rgba(0,0,0,0.5)', 128, 300, 9), roughness: 1 });
  (bankMat.map as THREE.Texture).repeat.set(6, 0.5);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, RIVER_BOTTOM - RIVER_TOP), bankMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.copy(W(ARENA_W / 2, (RIVER_TOP + RIVER_BOTTOM) / 2, -RIVER_DEPTH));
  bed.receiveShadow = true;
  group.add(bed);
  for (const y of [RIVER_TOP, RIVER_BOTTOM]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, RIVER_DEPTH), bankMat);
    wall.position.copy(W(ARENA_W / 2, y, -RIVER_DEPTH / 2));
    if (y === RIVER_TOP) wall.rotation.y = 0;
    else wall.rotation.y = Math.PI;
    group.add(wall);
  }
  // Bank stones along the edge.
  const rng = new Rng(99);
  const stoneGeo = new THREE.DodecahedronGeometry(0.22, 0);
  const stoneMat = new THREE.MeshStandardMaterial({ color: theme.rim, roughness: 0.9, flatShading: true });
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, 70);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const top = i % 2 === 0;
    const x = rng.range(0.2, ARENA_W - 0.2);
    if (BRIDGES.some((b) => Math.abs(x - b) < BRIDGE_HALF + 0.3)) {
      m4.makeScale(0, 0, 0);
    } else {
      const s = rng.range(0.6, 1.3);
      m4.compose(
        W(x, top ? RIVER_TOP + 0.05 : RIVER_BOTTOM - 0.05, -0.05),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0)),
        new THREE.Vector3(s, s * 0.7, s),
      );
    }
    stones.setMatrixAt(i, m4);
  }
  stones.castShadow = true;
  stones.receiveShadow = true;
  group.add(stones);

  // Animated water.
  const water1 = new THREE.Color(theme.water1);
  const water2 = new THREE.Color(theme.water2);
  const foam = new THREE.Color(theme.waterFoam);
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uC1: { value: water1 },
      uC2: { value: water2 },
      uFoam: { value: foam },
      uGlow: { value: theme.glow ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(uv.x * 40.0 + uTime * 2.0) * 0.015;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uC1, uC2, uFoam;
      uniform float uGlow;
      float wave(vec2 p) {
        return sin(p.x * 3.0 + uTime * 1.3 + sin(p.y * 6.0 + uTime) * 0.8) * 0.5 + 0.5;
      }
      void main() {
        vec2 p = vec2(vUv.x * 18.0, vUv.y * 2.0);
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        vec3 col = mix(uC2, uC1, 0.35 + 0.65 * edge);
        float w = wave(p * vec2(1.0, 1.0) + vec2(uTime * 0.25, 0.0));
        float lines = smoothstep(0.92, 1.0, sin(p.x * 2.2 - uTime * 1.6 + sin(p.y * 7.0) * 1.5) * 0.5 + 0.5);
        col += uFoam * lines * 0.35 * edge;
        col += uFoam * (1.0 - edge) * 0.45;
        col = mix(col, col * 1.12, w * 0.4);
        if (uGlow > 0.5) col += uC1 * (0.25 + 0.15 * sin(uTime * 2.0 + p.x));
        gl_FragColor = vec4(col, 0.92);
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_W, RIVER_BOTTOM - RIVER_TOP, 64, 4), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.copy(W(ARENA_W / 2, (RIVER_TOP + RIVER_BOTTOM) / 2, -0.14));
  group.add(water);

  // Bridges: plank decks with rails and posts (merged into a few draw calls).
  const bridgeGroup = new THREE.Group();
  const plank = plankTexture();
  const deckMat = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: '#6e4624', roughness: 0.8 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#4f3218', roughness: 0.8 });
  for (const bx of BRIDGES) {
    const len = RIVER_BOTTOM - RIVER_TOP + 1.3;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE_HALF * 2, 0.18, len), deckMat);
    deck.position.copy(W(bx, (RIVER_TOP + RIVER_BOTTOM) / 2, -0.06));
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridgeGroup.add(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, len), railMat);
      rail.position.copy(W(bx + side * (BRIDGE_HALF - 0.05), (RIVER_TOP + RIVER_BOTTOM) / 2, 0.42));
      rail.castShadow = true;
      bridgeGroup.add(rail);
      for (let k = 0; k < 4; k++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), postMat);
        post.position.copy(W(bx + side * (BRIDGE_HALF - 0.05), RIVER_TOP - 0.55 + (k * len) / 3.3, 0.2));
        post.castShadow = true;
        bridgeGroup.add(post);
      }
    }
  }
  group.add(mergeByMaterial(bridgeGroup));

  // Raised stone rim around the arena.
  const rimTex = brickTexture(theme.rim, '#4a4740', 2, 8);
  const rimMat = new THREE.MeshStandardMaterial({ map: rimTex, roughness: 0.9 });
  const rimH = 0.45;
  const rimT = 0.45;
  const rimGroup = new THREE.Group();
  const rim = (w: number, d: number, x: number, y: number) => {
    const g = new THREE.BoxGeometry(w, rimH, d);
    const m = new THREE.Mesh(g, rimMat);
    m.position.copy(W(x, y, rimH / 2 - 0.05));
    m.castShadow = true;
    m.receiveShadow = true;
    rimGroup.add(m);
  };
  rim(ARENA_W + rimT * 2, rimT, ARENA_W / 2, -rimT / 2);
  rim(ARENA_W + rimT * 2, rimT, ARENA_W / 2, ARENA_H + rimT / 2);
  for (const side of [0, 1]) {
    const x = side ? ARENA_W + rimT / 2 : -rimT / 2;
    rim(rimT, RIVER_TOP, x, RIVER_TOP / 2);
    rim(rimT, ARENA_H - RIVER_BOTTOM, x, (RIVER_BOTTOM + ARENA_H) / 2);
  }
  rimTex.repeat.set(10, 1);
  group.add(mergeByMaterial(rimGroup));

  // Surroundings.
  const outsideTex = noiseTexture(theme.outside, theme.outsideDark, 256, 1200, 4);
  outsideTex.repeat.set(14, 14);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(90, 110), new THREE.MeshStandardMaterial({ map: outsideTex, roughness: 1 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.25;
  outside.receiveShadow = true;
  group.add(outside);
  // Water continues outside the arena.
  const outerWater = new THREE.Mesh(new THREE.PlaneGeometry(90, RIVER_BOTTOM - RIVER_TOP + 0.4), new THREE.MeshStandardMaterial({ color: theme.water2, roughness: 0.3, metalness: 0.1 }));
  outerWater.rotation.x = -Math.PI / 2;
  outerWater.position.copy(W(ARENA_W / 2, (RIVER_TOP + RIVER_BOTTOM) / 2, -0.22));
  group.add(outerWater);
  addDecor(group, theme);

  // Terrain takes only a little of the studio environment light (it's for the models).
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && 'envMapIntensity' in m) m.envMapIntensity = 0.25;
  });
  return {
    group,
    update(t: number) {
      waterMat.uniforms.uTime.value = t;
    },
  };
}

function addDecor(group: THREE.Group, theme: ArenaTheme): void {
  const rng = new Rng(17);
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 400 && spots.length < 120; i++) {
    const x = rng.range(-22, 22);
    const z = rng.range(-30, 26);
    const inArena = Math.abs(x) < ARENA_W / 2 + 1.2 && Math.abs(z) < ARENA_H / 2 + 1.2;
    const inRiver = z > RIVER_TOP - ARENA_H / 2 - 1 && z < RIVER_BOTTOM - ARENA_H / 2 + 1;
    if (inArena || inRiver) continue;
    spots.push(new THREE.Vector3(x, -0.25, z));
  }
  const dark = new THREE.Color(theme.decorColor2);
  const light = new THREE.Color(theme.decorColor);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const place = (mesh: THREE.InstancedMesh, i: number, p: THREE.Vector3, scale: number, yOff = 0) => {
    q.setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));
    s.set(scale, scale, scale);
    m4.compose(new THREE.Vector3(p.x, p.y + yOff * scale, p.z), q, s);
    mesh.setMatrixAt(i, m4);
  };
  const n = spots.length;
  switch (theme.decor) {
    case 'pines': {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#5a3a22' }), n);
      const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(0.85, 2.2, 7), new THREE.MeshStandardMaterial({ color: light, flatShading: true }), n);
      const snow = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 0.7, 7), new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true }), n);
      spots.forEach((p, i) => {
        const sc = rng.range(0.8, 1.6);
        place(trunk, i, p, sc, 0.3);
        place(cone, i, p, sc, 1.5);
        place(snow, i, p, sc, 2.4);
      });
      for (const m of [trunk, cone, snow]) {
        m.castShadow = true;
        group.add(m);
      }
      break;
    }
    case 'rocks':
    case 'graves': {
      const geo = theme.decor === 'graves' ? new THREE.BoxGeometry(0.7, 1, 0.25) : new THREE.DodecahedronGeometry(0.7, 0);
      const rocks = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: light, flatShading: true, roughness: 0.95 }), n);
      spots.forEach((p, i) => place(rocks, i, p, rng.range(0.6, 1.8), 0.35));
      rocks.castShadow = true;
      group.add(rocks);
      if (theme.glow) {
        const crys = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.25, 0), new THREE.MeshStandardMaterial({ color: theme.glow, emissive: theme.glow, emissiveIntensity: 1.2 }), n);
        spots.forEach((p, i) => place(crys, i, new THREE.Vector3(p.x + 0.5, p.y, p.z + 0.3), rng.range(0.6, 1.4), 0.3));
        group.add(crys);
      }
      break;
    }
    case 'clouds': {
      const puff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), n * 3);
      spots.forEach((p, i) => {
        for (let k = 0; k < 3; k++) place(puff, i * 3 + k, new THREE.Vector3(p.x + (k - 1) * 0.9, p.y - 0.6, p.z + rng.range(-0.3, 0.3)), rng.range(0.6, 1.1), 0.2);
      });
      group.add(puff);
      break;
    }
    default: {
      // Round leafy trees (meadow, swamp).
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 6), new THREE.MeshStandardMaterial({ color: '#6b4426' }), n);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshStandardMaterial({ color: light, flatShading: true, roughness: 0.9 }), n);
      const crown2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 1), new THREE.MeshStandardMaterial({ color: dark, flatShading: true, roughness: 0.9 }), n);
      spots.forEach((p, i) => {
        const sc = rng.range(0.8, 1.5);
        place(trunk, i, p, sc, 0.45);
        place(crown, i, p, sc, 1.45);
        place(crown2, i, new THREE.Vector3(p.x + 0.45 * sc, p.y, p.z + 0.2), sc, 1.1);
      });
      for (const m of [trunk, crown, crown2]) {
        m.castShadow = true;
        group.add(m);
      }
      // Bushes and flowers near the rim.
      const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.4, 0), new THREE.MeshStandardMaterial({ color: light, flatShading: true }), 40);
      for (let i = 0; i < 40; i++) {
        const side = i % 2 ? 1 : -1;
        place(bush, i, new THREE.Vector3(side * (ARENA_W / 2 + rng.range(1, 2.2)), -0.25, rng.range(-ARENA_H / 2, ARENA_H / 2)), rng.range(0.7, 1.3), 0.2);
      }
      bush.castShadow = true;
      group.add(bush);
    }
  }
}
