import type { Team } from '../engine/types';

export interface Sprite {
  img: HTMLImageElement | HTMLCanvasElement;
  w: number;
  h: number;
}

interface Entry {
  w: number;
  h: number;
  red?: boolean;
}

const BASE = `${import.meta.env.BASE_URL}assets/sprites/`;
let manifest: Record<string, Entry> = {};
const images = new Map<string, Sprite>();
const tinted = new Map<string, Sprite>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Load every sprite listed in the manifest. Missing files simply fall back to procedural art. */
export async function loadSprites(onProgress?: (f: number) => void): Promise<void> {
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    manifest = res.ok ? await res.json() : {};
  } catch {
    manifest = {};
  }
  const jobs: [string, string][] = [];
  for (const [name, e] of Object.entries(manifest)) {
    jobs.push([name, `${BASE}${name}.webp`]);
    if (e.red) jobs.push([`${name}_red`, `${BASE}${name}_red.webp`]);
  }
  let done = 0;
  await Promise.all(
    jobs.map(async ([key, src]) => {
      const img = await loadImage(src);
      if (img) images.set(key, { img, w: img.naturalWidth, h: img.naturalHeight });
      done++;
      onProgress?.(done / jobs.length);
    }),
  );
}

export function spriteUrl(name: string): string | null {
  return manifest[name] ? `${BASE}${name}.webp` : null;
}

export function hasSprite(name: string): boolean {
  return images.has(name);
}

export function getSprite(name: string, team: Team = 0): Sprite | null {
  if (team === 1) {
    const red = images.get(`${name}_red`);
    if (red) return red;
  }
  return images.get(name) ?? null;
}

/** A solid-colour silhouette of a sprite (hit flash, freeze tint, ghosts). */
export function tintedSprite(name: string, team: Team, color: string, alpha = 1): Sprite | null {
  const key = `${name}|${team}|${color}|${alpha}`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const base = getSprite(name, team);
  if (!base) return null;
  const c = document.createElement('canvas');
  c.width = base.w;
  c.height = base.h;
  const g = c.getContext('2d')!;
  g.drawImage(base.img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  const s = { img: c, w: c.width, h: c.height };
  tinted.set(key, s);
  return s;
}
