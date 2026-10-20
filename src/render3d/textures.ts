import * as THREE from 'three';
import { ARENA_H, ARENA_W, BRIDGES, RIVER_BOTTOM, RIVER_TOP, TOWER_SPOTS } from '../engine/arena';
import { Rng } from '../engine/rng';
import type { ArenaTheme } from '../render/themes';

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
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

/** Painted arena floor: checkered grass, dirt lanes, tower pads, river bed. 1 tile = PX pixels. */
export function arenaFloorTexture(t: ArenaTheme, PX = 48): THREE.CanvasTexture {
  const [c, g] = canvas(ARENA_W * PX, ARENA_H * PX);
  const rng = new Rng(7);
  for (let j = 0; j < ARENA_H; j++) {
    for (let i = 0; i < ARENA_W; i++) {
      g.fillStyle = (i + j) % 2 ? t.grassA : t.grassB;
      g.fillRect(i * PX, j * PX, PX, PX);
    }
  }
  // Grass tufts and speckles.
  for (let i = 0; i < 5000; i++) {
    const x = rng.range(0, c.width);
    const y = rng.range(0, c.height);
    g.fillStyle = rng.next() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';
    g.fillRect(x, y, PX * 0.04, PX * rng.range(0.08, 0.18));
  }
  for (let i = 0; i < 120; i++) {
    const x = rng.range(0, c.width);
    const y = rng.range(0, c.height);
    g.fillStyle = rng.pick(['#fff6a8', '#ffffff', '#ffb8d0', '#b8d8ff']);
    g.globalAlpha = 0.5;
    g.beginPath();
    g.arc(x, y, PX * 0.05, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const path = (x0: number, y0: number, x1: number, y1: number) => {
    g.fillStyle = t.pathEdge;
    rr(g, x0 * PX - 3, y0 * PX - 3, (x1 - x0) * PX + 6, (y1 - y0) * PX + 6, PX * 0.5);
    g.fill();
    g.fillStyle = t.path;
    rr(g, x0 * PX, y0 * PX, (x1 - x0) * PX, (y1 - y0) * PX, PX * 0.45);
    g.fill();
  };
  for (const bx of BRIDGES) {
    path(bx - 0.95, 6.5, bx + 0.95, RIVER_TOP + 0.4);
    path(bx - 0.95, RIVER_BOTTOM - 0.4, bx + 0.95, 25.5);
  }
  path(3.5, 2.4, 14.5, 3.6);
  path(3.5, 28.4, 14.5, 29.6);
  path(2.6, 2.4, 4.4, 7);
  path(13.6, 2.4, 15.4, 7);
  path(2.6, 25, 4.4, 29.6);
  path(13.6, 25, 15.4, 29.6);
  for (let i = 0; i < 260; i++) {
    const bx = rng.pick(BRIDGES);
    const x = (bx + rng.range(-0.9, 0.9)) * PX;
    const y = (rng.next() < 0.5 ? rng.range(6.5, 15) : rng.range(17, 25.5)) * PX;
    g.fillStyle = rng.next() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.ellipse(x, y, PX * rng.range(0.03, 0.09), PX * rng.range(0.02, 0.06), rng.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  for (const s of TOWER_SPOTS) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.ellipse(s.x * PX, (s.y + 0.15) * PX, (s.radius + 0.6) * PX, (s.radius + 0.55) * PX, 0, 0, Math.PI * 2);
    g.fill();
    // Flagstones.
    const R = s.radius + 0.5;
    for (let k = 0; k < 40; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * R;
      g.fillStyle = shade(t.rim, rng.range(-0.15, 0.2));
      g.beginPath();
      g.ellipse((s.x + Math.cos(a) * d) * PX, (s.y + Math.sin(a) * d) * PX, PX * rng.range(0.25, 0.45), PX * rng.range(0.18, 0.32), rng.range(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  }
  // River bed (seen under the water).
  g.fillStyle = t.bank;
  g.fillRect(0, RIVER_TOP * PX, c.width, (RIVER_BOTTOM - RIVER_TOP) * PX);
  const tx = tex(c);
  tx.anisotropy = 8;
  return tx;
}

export function noiseTexture(base: string, dark: string, size = 256, blobs = 900, seed = 3): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const rng = new Rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < blobs; i++) {
    g.fillStyle = rng.next() < 0.6 ? dark : 'rgba(255,255,255,0.08)';
    g.globalAlpha = rng.range(0.15, 0.45);
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(1, size * 0.03);
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  return tex(c, true);
}

export function brickTexture(stone = '#b5ad9f', mortar = '#7d766b', rows = 8, cols = 6): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const rng = new Rng(11);
  g.fillStyle = mortar;
  g.fillRect(0, 0, 256, 256);
  const bh = 256 / rows;
  const bw = 256 / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k < cols + 1; k++) {
      const x = k * bw + (r % 2 ? bw / 2 : 0);
      g.fillStyle = shade(stone, rng.range(-0.12, 0.12));
      rr(g, x + 2, r * bh + 2, bw - 4, bh - 4, 5);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x + 4, r * bh + 3, bw - 8, 3);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x + 4, r * bh + bh - 6, bw - 8, 3);
    }
  }
  return tex(c, true);
}

export function plankTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const rng = new Rng(5);
  const n = 8;
  for (let i = 0; i < n; i++) {
    g.fillStyle = shade('#a8743f', rng.range(-0.15, 0.1));
    g.fillRect(0, (i * 256) / n, 128, 256 / n - 3);
    g.fillStyle = '#5a391d';
    g.fillRect(0, ((i + 1) * 256) / n - 3, 128, 3);
    g.strokeStyle = 'rgba(0,0,0,0.15)';
    g.beginPath();
    g.moveTo(0, (i * 256) / n + 10);
    g.bezierCurveTo(40, (i * 256) / n + 6, 80, (i * 256) / n + 18, 128, (i * 256) / n + 12);
    g.stroke();
    g.fillStyle = '#3d2814';
    g.beginPath();
    g.arc(10, (i * 256) / n + 16, 2.5, 0, Math.PI * 2);
    g.arc(118, (i * 256) / n + 16, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, true);
}

export function radialTexture(stops: [number, string][], size = 128): THREE.CanvasTexture {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function bannerTexture(color: string, dark: string): THREE.CanvasTexture {
  const [c, g] = canvas(64, 128);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 0);
  g.lineTo(64, 110);
  g.lineTo(32, 128);
  g.lineTo(0, 110);
  g.closePath();
  g.fill();
  g.fillStyle = dark;
  g.fillRect(0, 0, 64, 8);
  g.strokeStyle = '#ffd23f';
  g.lineWidth = 4;
  g.strokeRect(6, 14, 52, 86);
  // Crown emblem.
  g.fillStyle = '#ffd23f';
  g.beginPath();
  g.moveTo(16, 70);
  g.lineTo(16, 46);
  g.lineTo(24, 56);
  g.lineTo(32, 40);
  g.lineTo(40, 56);
  g.lineTo(48, 46);
  g.lineTo(48, 70);
  g.closePath();
  g.fill();
  return tex(c);
}

export function ringTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.stroke();
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function scorchTexture(kind: 'scorch' | 'ice' | 'crater'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const rng = new Rng(kind.length * 31);
  if (kind === 'ice') {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(235,252,255,0.95)');
    gr.addColorStop(0.7, 'rgba(190,240,255,0.7)');
    gr.addColorStop(1, 'rgba(190,240,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, Math.PI * 2);
      g.beginPath();
      g.moveTo(64, 64);
      g.lineTo(64 + Math.cos(a) * 55, 64 + Math.sin(a) * 55);
      g.stroke();
    }
  } else {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    gr.addColorStop(0, kind === 'crater' ? 'rgba(25,15,10,0.95)' : 'rgba(20,14,10,0.85)');
    gr.addColorStop(0.6, 'rgba(30,20,12,0.55)');
    gr.addColorStop(1, 'rgba(30,20,12,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(20, 50);
      g.beginPath();
      g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rng.range(3, 8), 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = tex(c);
  return t;
}

/**
 * Swap the royal-blue team colour in an image to crimson (same rule as tools/cutout.py),
 * returning a new canvas. Used to make enemy versions of model textures at load time.
 */
export function recolorRed(src: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const w = (src as HTMLImageElement).naturalWidth || src.width;
  const h = (src as HTMLImageElement).naturalHeight || src.height;
  const [c, g] = canvas(w, h);
  g.drawImage(src, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const gg = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const max = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    const delta = max - min;
    if (delta < 0.05 || max === 0) continue;
    let hue: number;
    if (max === r) hue = 60 * (((gg - b) / delta) % 6);
    else if (max === gg) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - gg) / delta + 4);
    if (hue < 0) hue += 360;
    const s = delta / max;
    const v = max;
    const dist = Math.abs(hue - 222);
    const wHue = Math.min(1, Math.max(0, 1 - (dist - 34) / 14));
    const wSat = Math.min(1, Math.max(0, (s - 0.18) / 0.15));
    const wgt = wHue * wSat;
    if (wgt <= 0) continue;
    const deltaH = ((2 - hue + 540) % 360) - 180;
    const nh = (hue + deltaH * wgt + 360) % 360;
    const nv = Math.min(1, v * (1 - 0.06 * wgt));
    const ns = Math.min(1, s * (1 + 0.06 * wgt));
    // HSV -> RGB
    const C = nv * ns;
    const X = C * (1 - Math.abs(((nh / 60) % 2) - 1));
    const m = nv - C;
    let rr2 = 0;
    let gg2 = 0;
    let bb2 = 0;
    if (nh < 60) [rr2, gg2, bb2] = [C, X, 0];
    else if (nh < 120) [rr2, gg2, bb2] = [X, C, 0];
    else if (nh < 180) [rr2, gg2, bb2] = [0, C, X];
    else if (nh < 240) [rr2, gg2, bb2] = [0, X, C];
    else if (nh < 300) [rr2, gg2, bb2] = [X, 0, C];
    else [rr2, gg2, bb2] = [C, 0, X];
    d[i] = (rr2 + m) * 255;
    d[i + 1] = (gg2 + m) * 255;
    d[i + 2] = (bb2 + m) * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
