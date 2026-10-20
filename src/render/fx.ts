/** Lightweight particle + transient effect system, in arena tile coordinates. */

export type ParticleKind = 'spark' | 'smoke' | 'debris' | 'ember' | 'snow' | 'heal' | 'star' | 'dust';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  spin: number;
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  fill?: string;
}

export interface Bolt {
  pts: { x: number; y: number; h?: number }[];
  life: number;
  max: number;
  color: string;
  width: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

export interface Decal {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  kind: 'scorch' | 'ice' | 'rubble' | 'crater';
  seed: number;
}

export interface Ghost {
  sprite: string;
  team: 0 | 1;
  x: number;
  y: number;
  h: number;
  life: number;
  max: number;
  flying: boolean;
}

export interface Glow {
  x: number;
  y: number;
  h: number;
  size: number;
  color: string;
  life: number;
  max: number;
}

export class Fx {
  particles: Particle[] = [];
  glows: Glow[] = [];
  rings: Ring[] = [];
  bolts: Bolt[] = [];
  texts: FloatText[] = [];
  decals: Decal[] = [];
  ghosts: Ghost[] = [];
  shake = 0;
  flash = 0;
  flashColor = '#fff';

  burst(
    x: number,
    y: number,
    n: number,
    o: Partial<Particle> & { speed?: number; up?: number; spread?: number; colors?: string[] },
  ): void {
    const speed = o.speed ?? 2;
    const colors = o.colors ?? [o.color ?? '#fff'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const max = (o.max ?? 0.6) * (0.6 + Math.random() * 0.7);
      this.particles.push({
        kind: o.kind ?? 'spark',
        x: x + (Math.random() - 0.5) * (o.spread ?? 0.2),
        y: y + (Math.random() - 0.5) * (o.spread ?? 0.2),
        z: o.z ?? 0.4,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.7,
        vz: (o.up ?? 2) * (0.5 + Math.random()),
        life: max,
        max,
        size: (o.size ?? 0.12) * (0.6 + Math.random() * 0.8),
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: o.gravity ?? 6,
        spin: (Math.random() - 0.5) * 10,
      });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  ring(x: number, y: number, r1: number, color: string, max = 0.45, width = 0.12, r0 = 0.1, fill?: string): void {
    this.rings.push({ x, y, r0, r1, life: max, max, color, width, fill });
  }

  /** Lightning from (x0,y0) at height h0 down to (x1,y1) at height h1, jagged. */
  bolt(x0: number, y0: number, x1: number, y1: number, color = '#bff4ff', width = 0.14, max = 0.25, h0 = 0, h1 = 0): void {
    const pts: { x: number; y: number; h: number }[] = [{ x: x0, y: y0, h: h0 }];
    const segs = 8;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      pts.push({
        x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * 0.8,
        y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * 0.5,
        h: h0 + (h1 - h0) * t + (Math.random() - 0.5) * 0.3,
      });
    }
    pts.push({ x: x1, y: y1, h: h1 });
    this.bolts.push({ pts, life: max, max, color, width });
  }

  text(x: number, y: number, text: string, color = '#fff', size = 0.7, max = 1.1): void {
    this.texts.push({ x, y, text, color, life: max, max, size });
  }

  decal(x: number, y: number, r: number, kind: Decal['kind'], max = 6): void {
    this.decals.push({ x, y, r, kind, life: max, max, seed: Math.random() * 1000 });
    if (this.decals.length > 40) this.decals.shift();
  }

  ghost(g: Omit<Ghost, 'life' | 'max'>, max = 0.5): void {
    this.ghosts.push({ ...g, life: max, max });
  }

  /** A bright additive light burst (explosions, zaps, impacts). */
  glow(x: number, y: number, size: number, color = '#ffd27a', max = 0.35, h = 0.6): void {
    this.glows.push({ x, y, h, size, color, life: max, max });
    if (this.glows.length > 40) this.glows.shift();
  }

  addShake(v: number): void {
    this.shake = Math.min(0.6, this.shake + v);
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= p.gravity * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      if (p.kind === 'smoke' || p.kind === 'dust') {
        p.size += dt * 0.5;
        p.vx *= 0.96;
        p.vy *= 0.96;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= dt * 0.9;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const d of this.decals) d.life -= dt;
    this.decals = this.decals.filter((d) => d.life > 0);
    for (const g of this.glows) g.life -= dt;
    this.glows = this.glows.filter((g) => g.life > 0);
    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }
}
