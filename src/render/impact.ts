/**
 * Impact recipes: layered effects that give attacks and spells weight.
 * Every recipe stacks the same beats: a white-hot flash, a fast shockwave,
 * debris thrown out, lingering smoke, then screen shake / camera punch.
 */
import type { Fx } from './fx';

export interface Feel {
  /** Seconds of near-freeze to apply to the simulation (0 = none). */
  hitStop: number;
  /** 0..1 haptic strength hint. */
  rumble: number;
}

const NONE: Feel = { hitStop: 0, rumble: 0 };

/** Fireball / meteor / splash fire: the big one. */
export function fireBlast(fx: Fx, x: number, y: number, r: number, scale: 'small' | 'medium' | 'big'): Feel {
  const k = scale === 'big' ? 1.5 : scale === 'medium' ? 1 : 0.55;
  // Beat 1: white-hot flash, then the orange bloom.
  fx.glow(x, y, r * 2.4 * k, '#ffffff', 0.1, 0.9);
  fx.glow(x, y, r * 4.4 * k, '#ff9a3a', 0.5 * k, 0.8);
  fx.glow(x, y, r * 2.2 * k, '#ffe2a0', 0.22, 1.4);
  if (scale !== 'small') {
    fx.flash = Math.max(fx.flash, scale === 'big' ? 0.4 : 0.22);
    fx.flashColor = '#fff0cc';
  }
  // Beat 2: shockwave (fast bright ring + slower fire ring) and a dust halo along the ground.
  fx.ring(x, y, r * 1.5, '#ffffff', 0.22, 0.28, 0.2);
  fx.ring(x, y, r, '#ffb347', 0.45, 0.22, 0.2, 'rgba(255,140,40,0.3)');
  if (scale !== 'small') fx.ring(x, y, r * 1.9, 'rgba(255,200,120,0.55)', 0.6, 0.12, r * 0.6);
  fx.radial(x, y, Math.round(14 * k), { kind: 'dust', colors: ['#cdb98f', '#a8946c', '#e2d3ae'], speed: 4.2 * k, up: 0.6, gravity: 1.5, max: 0.7, size: 0.3, offset: r * 0.3 });
  // Beat 3: fire, debris and smoke.
  fx.burst(x, y, Math.round(34 * k), { kind: 'ember', colors: ['#fff3b0', '#ffb347', '#ff6a2a', '#ff3d1a'], speed: 5.5 * k, up: 5 * k, max: 0.9, size: 0.17, spread: r * 0.5 });
  fx.burst(x, y, Math.round(14 * k), { kind: 'debris', colors: ['#6b5444', '#8a6a4a', '#3d332c'], speed: 4 * k, up: 6 * k, max: 1, size: 0.17, gravity: 12, spread: r * 0.4 });
  fx.burst(x, y, Math.round(16 * k), { kind: 'smoke', colors: ['#5a4a42', '#3d3330', '#7a6a60'], speed: 1.8, up: 2.4, gravity: -0.4, max: 1.4, size: 0.5, spread: r * 0.6 });
  fx.decal(x, y, r * 0.8, scale === 'big' ? 'crater' : 'scorch', 7);
  // Beat 4: camera.
  fx.addShake(0.2 + 0.25 * k);
  fx.addPunch(0.35 * k);
  return scale === 'big' ? { hitStop: 0.09, rumble: 1 } : scale === 'medium' ? { hitStop: 0.06, rumble: 0.6 } : { hitStop: 0, rumble: 0.25 };
}

/** Cannonball / bomb: heavy chunky blast without the flame bloom. */
export function bombBlast(fx: Fx, x: number, y: number, r: number): Feel {
  fx.glow(x, y, r * 2, '#ffffff', 0.1, 0.8);
  fx.glow(x, y, r * 3.4, '#ffb04a', 0.35, 0.6);
  fx.ring(x, y, r * 1.3, '#ffffff', 0.2, 0.22, 0.2);
  fx.ring(x, y, r, '#ffd27a', 0.4, 0.2);
  fx.radial(x, y, 12, { kind: 'dust', colors: ['#cdb98f', '#a8946c'], speed: 3.4, up: 0.5, gravity: 1.5, max: 0.6, size: 0.26, offset: r * 0.3 });
  fx.burst(x, y, 22, { kind: 'ember', colors: ['#fff3b0', '#ffb347', '#ff6a2a'], speed: 4.2, up: 4, max: 0.6, size: 0.14 });
  fx.burst(x, y, 9, { kind: 'debris', colors: ['#6b5444', '#8a6a4a'], speed: 3.4, up: 5, max: 0.9, size: 0.15, gravity: 12 });
  fx.burst(x, y, 12, { kind: 'smoke', colors: ['#444', '#666', '#888'], speed: 1.6, up: 1.8, gravity: -0.2, max: 1, size: 0.45 });
  fx.decal(x, y, r * 0.6, 'scorch', 5);
  fx.addShake(0.3);
  fx.addPunch(0.25);
  return { hitStop: 0.05, rumble: 0.5 };
}

/** Arrow volley: shafts thud into the ground in a ring of dust. */
export function arrowRain(fx: Fx, x: number, y: number, r: number): Feel {
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d * 0.85;
    fx.burst(px, py, 2, { kind: 'dust', colors: ['#d9c8a6', '#c4b08a'], speed: 0.9, up: 0.9, max: 0.4, size: 0.13, z: 0.1 });
    fx.burst(px, py, 1, { kind: 'spark', colors: ['#fff3d0'], speed: 1.2, up: 2, max: 0.25, size: 0.07, z: 0.2 });
  }
  fx.ring(x, y, r, 'rgba(230,214,170,0.7)', 0.35, 0.1, r * 0.3);
  fx.addShake(0.12);
  return { hitStop: 0, rumble: 0.2 };
}

/** Zap: a ground flash with arcing sparks. */
export function zapBlast(fx: Fx, x: number, y: number, r: number): Feel {
  fx.glow(x, y, r * 3.4, '#ffffff', 0.12, 0.9);
  fx.glow(x, y, r * 3, '#9fe8ff', 0.3, 0.8);
  fx.ring(x, y, r * 1.2, '#ffffff', 0.18, 0.2, 0.2);
  fx.ring(x, y, r, '#bff4ff', 0.32, 0.15, 0.2, 'rgba(160,230,255,0.28)');
  fx.burst(x, y, 18, { kind: 'spark', colors: ['#ffffff', '#bff4ff', '#6fd6ff'], speed: 4.5, up: 3, max: 0.4, size: 0.1 });
  fx.addShake(0.18);
  fx.addPunch(0.15);
  return { hitStop: 0.04, rumble: 0.35 };
}

/** Thunder: sky-splitting strike at a point. */
export function thunderStrike(fx: Fx, x: number, y: number): Feel {
  fx.glow(x, y, 8, '#ffffff', 0.14, 1);
  fx.glow(x, y, 6, '#fff6c0', 0.45, 1);
  fx.ring(x, y, 1.9, '#ffffff', 0.2, 0.25, 0.2);
  fx.ring(x, y, 1.6, '#fff6a0', 0.4, 0.2);
  fx.radial(x, y, 10, { kind: 'dust', colors: ['#d8d0b8', '#bfb69a'], speed: 3, up: 0.4, max: 0.5, size: 0.24 });
  fx.burst(x, y, 22, { kind: 'spark', colors: ['#ffffff', '#fff6a0', '#ffd23f'], speed: 5.5, up: 4.5, max: 0.5 });
  fx.decal(x, y, 0.8, 'scorch', 4);
  fx.addShake(0.32);
  fx.addPunch(0.3);
  fx.flash = Math.max(fx.flash, 0.3);
  fx.flashColor = '#fffbe0';
  return { hitStop: 0.06, rumble: 0.7 };
}

/** Melee / bullet hit on a single target: sparks + a slash ring facing out from the attacker. */
export function strike(fx: Fx, x: number, y: number, heavy: boolean, air: boolean, fromX?: number, fromY?: number): Feel {
  const z = air ? 1.6 : 0.6;
  let nx = 0;
  let ny = 0;
  if (fromX !== undefined && fromY !== undefined) {
    const d = Math.hypot(x - fromX, y - fromY) || 1;
    nx = (x - fromX) / d;
    ny = (y - fromY) / d;
  }
  // Spark spray biased away from the attacker.
  const n = heavy ? 9 : 4;
  const colors = heavy ? ['#ffffff', '#fff3b0', '#ffb347'] : ['#ffffff', '#ffe9a8'];
  fx.burst(x, y, n, { kind: 'spark', colors, speed: heavy ? 4 : 2.4, up: 2.5, z, max: heavy ? 0.4 : 0.3, size: heavy ? 0.14 : 0.09 });
  if (nx || ny) {
    fx.burst(x + nx * 0.2, y + ny * 0.2, heavy ? 5 : 2, { kind: 'spark', colors, speed: 5, up: 1.2, z, max: 0.22, size: 0.08, spread: 0.05 });
  }
  // Impact flash at the contact point.
  fx.glow(x, y, heavy ? 2.2 : 1.1, heavy ? '#fff3c0' : '#ffffff', heavy ? 0.16 : 0.1, z);
  if (heavy) {
    fx.ring(x, y, 1.1, '#ffffff', 0.22, 0.14, 0.15);
    if (!air) fx.burst(x, y, 4, { kind: 'dust', colors: ['#e8dcc0', '#d1c3a3'], speed: 1.8, up: 0.5, gravity: 1, max: 0.4, size: 0.2, z: 0.1 });
    fx.addShake(0.07);
    return { hitStop: 0.035, rumble: 0.3 };
  }
  return NONE;
}

/** A tower being struck: stone chips and a dust puff, no unit-style flinch. */
export function structureHit(fx: Fx, x: number, y: number, heavy: boolean): Feel {
  fx.burst(x, y, heavy ? 6 : 3, { kind: 'debris', colors: ['#9a958c', '#7d786f', '#b8b2a6'], speed: 2.4, up: 3, max: 0.6, size: 0.1, gravity: 10, z: 1.2 });
  fx.burst(x, y, 2, { kind: 'dust', colors: ['#d8d0c0'], speed: 0.8, up: 0.6, gravity: 0.5, max: 0.5, size: 0.25, z: 1 });
  if (heavy) {
    fx.addShake(0.1);
    return { hitStop: 0.03, rumble: 0.2 };
  }
  return NONE;
}

/** Muzzle flash / launch puff when something fires or casts. */
export function muzzle(fx: Fx, x: number, y: number, z: number, kind: string): void {
  switch (kind) {
    case 'cannon':
      fx.glow(x, y, 2.2, '#ffd27a', 0.12, z);
      fx.burst(x, y - 0.2, 6, { kind: 'smoke', color: '#dddddd', speed: 1, up: 1, gravity: 0, max: 0.5, size: 0.22, z });
      fx.burst(x, y - 0.2, 4, { kind: 'spark', colors: ['#fff3b0', '#ffb347'], speed: 3, up: 1, max: 0.2, size: 0.1, z });
      fx.addShake(0.04);
      break;
    case 'bullet':
      fx.glow(x, y, 1.1, '#ffe9a8', 0.08, z);
      fx.burst(x, y - 0.2, 3, { kind: 'smoke', color: '#dddddd', speed: 0.6, up: 1, gravity: 0, max: 0.4, size: 0.16, z });
      break;
    case 'fire':
      fx.glow(x, y, 1.6, '#ff9a3a', 0.16, z);
      fx.burst(x, y, 4, { kind: 'ember', colors: ['#ffb347', '#ff6a2a'], speed: 1.6, up: 1, max: 0.3, size: 0.12, z });
      break;
    case 'bolt':
    case 'arrow':
      fx.burst(x, y, 1, { kind: 'dust', color: '#e6dcc0', speed: 0.5, up: 0.3, max: 0.25, size: 0.12, z });
      break;
  }
}

/** A deployed unit thumping onto the field. Bigger units hit harder. */
export function landing(fx: Fx, x: number, y: number, radius: number): Feel {
  const big = radius >= 0.7;
  fx.radial(x, y, big ? 14 : 8, { kind: 'dust', colors: ['#e8dcc0', '#d1c3a3', '#bfae8a'], speed: big ? 3 : 1.8, up: 0.5, gravity: 1, max: 0.55, size: big ? 0.3 : 0.2, offset: radius * 0.4 });
  fx.ring(x, y, radius * (big ? 3.2 : 2.2), 'rgba(255,255,255,0.7)', 0.3, 0.08, radius * 0.6);
  if (big) {
    fx.burst(x, y, 6, { kind: 'debris', colors: ['#8a7a5a', '#6b5f48'], speed: 2.4, up: 3, max: 0.5, size: 0.1, gravity: 12 });
    fx.addShake(0.2);
    fx.addPunch(0.18);
    return { hitStop: 0.03, rumble: 0.4 };
  }
  fx.addShake(0.03);
  return NONE;
}
