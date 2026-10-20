import { CENTER_X, dist, mirror } from './arena';
import type { Battle, Unit } from './battle';
import { CARDS, UNITS, levelMul } from './cards';
import { POWERS } from './powers';
import { Rng } from './rng';
import type { CardDef, Team, Vec } from './types';

export interface AIProfile {
  /** Seconds between decisions [min, max]. */
  think: [number, number];
  /** 0..1 — how well it picks counters and spells. */
  skill: number;
  /** Mana at which it starts an attack. */
  pushMana: number;
  /** Reaction delay before it responds to a new threat. */
  reaction: number;
  /** Opening breathing room, measured in battle seconds. */
  openingDelay?: number;
}

export const AI_PROFILES: Record<'easy' | 'normal' | 'hard' | 'brutal', AIProfile> = {
  easy: { think: [2.5, 3.8], skill: 0.15, pushMana: 10, reaction: 2.4 },
  normal: { think: [0.9, 1.5], skill: 0.55, pushMana: 9, reaction: 1.0 },
  hard: { think: [0.5, 0.9], skill: 0.8, pushMana: 8, reaction: 0.55 },
  brutal: { think: [0.3, 0.55], skill: 0.95, pushMana: 7, reaction: 0.3 },
};

/** Approximate mana value of one unit, from the cheapest card that makes it. */
const UNIT_VALUE: Record<string, number> = (() => {
  const v: Record<string, number> = {};
  for (const c of Object.values(CARDS)) {
    if (!c.unit) continue;
    const per = c.cost / (c.count ?? 1);
    v[c.unit] = Math.min(v[c.unit] ?? Infinity, per);
  }
  v.imp = Math.min(v.imp ?? 1, 0.7);
  v.sentinel = 3;
  return v;
})();

interface Threat {
  units: Unit[];
  local: Vec[];
  value: number;
  lane: -1 | 1;
  deepest: number;
  air: number;
  swarm: number;
  tankHp: number;
  buildingHunters: number;
  centroid: Vec;
}

export class AIController {
  private thinkT = 1.5;
  private rng: Rng;
  private pending: { at: number; lane: -1 | 1 } | null = null;
  private seenThreatAt = new Map<number, number>();

  constructor(
    private battle: Battle,
    public team: Team,
    public profile: AIProfile,
    seed = 1234,
  ) {
    this.rng = new Rng(seed);
    this.thinkT = profile.openingDelay ?? 1.5;
  }

  /** World <-> local (the AI always reasons as if it were at the bottom). */
  private L(p: Vec): Vec {
    return this.team === 0 ? { x: p.x, y: p.y } : mirror(p);
  }

  update(dt: number): void {
    if (this.battle.phase === 'ended') return;
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = this.rng.range(this.profile.think[0], this.profile.think[1]);
    this.think();
  }

  private get me() {
    return this.battle.players[this.team];
  }

  private hand(): { id: string; i: number; card: CardDef }[] {
    return this.me.hand.map((id, i) => ({ id, i, card: CARDS[id] }));
  }

  private affordable() {
    return this.hand().filter((h) => h.card.cost <= this.me.mana);
  }

  private play(i: number, local: Vec): boolean {
    const world = this.L(local);
    const id = this.me.hand[i];
    // Nudge around if the exact spot is blocked.
    const tries: Vec[] = [world, { x: world.x + 1, y: world.y }, { x: world.x - 1, y: world.y }, { x: world.x, y: world.y + (this.team === 0 ? 1 : -1) }];
    for (const t of tries) {
      if (this.battle.placement(this.team, id, t.x, t.y)) return this.battle.deploy(this.team, i, t.x, t.y);
    }
    return false;
  }

  private think(): void {
    const b = this.battle;
    if (b.canUsePower(this.team) && this.tryPower()) return;
    const threats = this.threats();
    const top = threats[0];
    if (top && this.tryDefend(top)) return;
    if (this.trySpell()) return;
    if (this.pending && b.time >= this.pending.at && this.trySupport(this.pending.lane)) return;
    if (!top && this.me.mana >= this.profile.pushMana && this.tryPush()) return;
    if (this.me.mana >= 9.7) this.antiLeak();
  }

  // ------------------------------------------------------------ threat model

  private threats(): Threat[] {
    const b = this.battle;
    const groups = new Map<number, Threat>();
    for (const u of b.units) {
      if (u.dead || u.team === this.team || u.kind !== 'troop') continue;
      const lp = this.L(u);
      const hunter = u.s.targets === 'buildings';
      if (lp.y < (hunter ? 9 : 12.5)) continue;
      // Reaction delay: ignore brand-new threats for a moment.
      const first = this.seenThreatAt.get(u.id) ?? b.time;
      this.seenThreatAt.set(u.id, first);
      if (b.time - first < this.profile.reaction) continue;
      const lane: -1 | 1 = lp.x < CENTER_X ? -1 : 1;
      let g = groups.get(lane);
      if (!g) {
        g = { units: [], local: [], value: 0, lane, deepest: 0, air: 0, swarm: 0, tankHp: 0, buildingHunters: 0, centroid: { x: 0, y: 0 } };
        groups.set(lane, g);
      }
      const val = (UNIT_VALUE[u.s.id] ?? 2) * (u.hp / u.maxHp);
      g.units.push(u);
      g.local.push(lp);
      g.value += val;
      g.deepest = Math.max(g.deepest, lp.y);
      if (u.flying) g.air += val;
      if (u.maxHp < 260) g.swarm++;
      g.tankHp = Math.max(g.tankHp, u.hp);
      if (hunter) g.buildingHunters++;
    }
    const out = [...groups.values()];
    for (const g of out) {
      const n = g.local.length;
      g.centroid = { x: g.local.reduce((s, p) => s + p.x, 0) / n, y: g.local.reduce((s, p) => s + p.y, 0) / n };
      // Subtract what we already have defending there.
      g.value -= this.defenseValue(g) * 0.8;
    }
    return out.filter((g) => g.value > 0.6 || g.deepest > 22).sort((a, b) => b.deepest + b.value - (a.deepest + a.value));
  }

  private defenseValue(g: Threat): number {
    let v = 0;
    for (const u of this.battle.units) {
      if (u.dead || u.team !== this.team || u.kind === 'tower') continue;
      const lp = this.L(u);
      if (lp.y < 15) continue;
      if (dist(lp, g.centroid) > 7) continue;
      if (g.air > g.value * 0.5 && u.s.targets !== 'both') continue;
      v += (UNIT_VALUE[u.s.id] ?? 2) * (u.hp / u.maxHp);
    }
    return v;
  }

  private noise(scale = 3): number {
    return this.rng.range(-1, 1) * (1 - this.profile.skill) * scale;
  }

  private tryDefend(t: Threat): boolean {
    const urgent = t.deepest > 18 || t.buildingHunters > 0;
    const options = this.affordable().filter((h) => h.card.type !== 'spell');
    let best: { h: (typeof options)[number]; s: number } | null = null;
    const airMain = t.air > t.value * 0.45;
    for (const h of options) {
      const c = h.card;
      const u = c.unit ? UNITS[c.unit] : null;
      if (!u) continue;
      let s = 1;
      const hitsAir = u.targets === 'both';
      if (t.air > 0) s += hitsAir ? 3 : airMain ? -6 : -1;
      if (t.swarm >= 3) {
        if (c.tags.includes('splash')) s += 3;
        if (u.hp < 200) s -= 1.5;
      }
      if (t.tankHp >= 1200) {
        if (c.tags.includes('dps') || c.tags.includes('swarm')) s += 3;
        if (c.type === 'building') s += 2;
      }
      if (t.buildingHunters > 0) {
        if (c.type === 'building') s += 3;
        if (c.tags.includes('dps') || c.tags.includes('swarm')) s += 1.5;
      }
      if (u.targets === 'buildings') s -= 6;
      s -= Math.max(0, c.cost - (t.value + 1)) * 0.6;
      s += this.noise();
      if (!best || s > best.s) best = { h, s };
    }
    if (!best) return false;
    if (best.s < (urgent ? -1 : 1.5)) return false;
    return this.play(best.h.i, this.defenseSpot(best.h.card, t));
  }

  private defenseSpot(card: CardDef, t: Threat): Vec {
    const laneX = t.lane < 0 ? 3.5 : 14.5;
    const front = t.local.reduce((m, p) => (p.y > m.y ? p : m), t.local[0]);
    const clampY = (y: number) => Math.min(29, Math.max(18, y));
    if (card.type === 'building') {
      return { x: t.lane < 0 ? 7.5 : 10.5, y: 21.5 };
    }
    const u = UNITS[card.unit!];
    if (t.air > t.value * 0.45 && u.range >= 2) return { x: t.lane < 0 ? 5.5 : 12.5, y: 27.5 };
    if (card.tags.includes('swarm')) return { x: front.x, y: clampY(front.y + 1.2) };
    if (u.range >= 3) return { x: (front.x + laneX) / 2, y: clampY(front.y + u.range + 1) };
    return { x: front.x, y: clampY(front.y + 2.5) };
  }

  // ------------------------------------------------------------ spells

  private trySpell(): boolean {
    const b = this.battle;
    for (const h of this.affordable()) {
      const sp = h.card.spell;
      if (!sp) continue;
      const dmg = (sp.damage ?? 0) * levelMul(b.levelOf(this.team, h.id)) * this.me.mods.spellMul;
      if (sp.damage) {
        const best = this.bestCluster(sp.radius, dmg, sp.towerMul ?? 1, sp.travel === 'keep' ? 0.8 : 0, !!sp.freeze);
        const need = h.card.cost * (1.45 - this.profile.skill * 0.35);
        if (best && best.value >= need + this.noise(1.5)) return this.play(h.i, best.at);
      } else if (sp.rage) {
        const pack = this.ownPack(sp.radius, true);
        if (pack && pack.count >= 3 && pack.value >= 7) return this.play(h.i, pack.at);
      } else if (sp.heal) {
        const pack = this.ownPack(sp.radius, false);
        if (pack && pack.missing >= 500) return this.play(h.i, pack.at);
      }
    }
    return false;
  }

  private bestCluster(radius: number, dmg: number, towerMul: number, lead: number, freeze: boolean): { at: Vec; value: number } | null {
    const b = this.battle;
    const enemies = b.units.filter((u) => !u.dead && u.team !== this.team);
    let best: { at: Vec; value: number } | null = null;
    for (const c of enemies) {
      if (c.kind === 'tower' && !freeze) continue;
      const lc = this.L(c);
      const at = c.kind === 'troop' ? { x: lc.x, y: lc.y + lead } : lc;
      let value = 0;
      for (const e of enemies) {
        const le = this.L(e);
        if (dist(le, at) > radius + e.s.radius * 0.7) continue;
        if (e.kind === 'tower') {
          value += freeze ? 0 : ((dmg * towerMul) / e.maxHp) * 8 + (e.hp <= dmg * towerMul ? 10 : 0);
        } else if (freeze) {
          value += (UNIT_VALUE[e.s.id] ?? 2) * 0.6;
        } else {
          value += Math.min(1, dmg / Math.max(1, e.hp)) * (UNIT_VALUE[e.s.id] ?? 2) * (e.hp <= dmg ? 1.2 : 0.8);
        }
      }
      if (!best || value > best.value) best = { at, value };
    }
    // Finishing blow on a nearly-dead tower.
    if (!freeze) {
      for (const t of enemies) {
        if (t.kind !== 'tower') continue;
        if (t.hp <= dmg * towerMul && (!best || best.value < 50)) best = { at: this.L(t), value: 50 };
      }
    }
    return best;
  }

  private ownPack(radius: number, attacking: boolean): { at: Vec; count: number; value: number; missing: number } | null {
    const mine = this.battle.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop');
    let best: { at: Vec; count: number; value: number; missing: number } | null = null;
    for (const c of mine) {
      const lc = this.L(c);
      if (attacking && lc.y > 16) continue;
      let count = 0;
      let value = 0;
      let missing = 0;
      for (const u of mine) {
        if (dist(this.L(u), lc) > radius) continue;
        count++;
        value += UNIT_VALUE[u.s.id] ?? 2;
        missing += u.maxHp - u.hp;
      }
      if (!best || value > best.value) best = { at: lc, count, value, missing };
    }
    return best;
  }

  // ------------------------------------------------------------ attack

  private pickLane(): -1 | 1 {
    const enemy: Team = this.team === 0 ? 1 : 0;
    const b = this.battle;
    // In local coords our left is the enemy's right when mirrored, so evaluate in world space.
    const towers = ([-1, 1] as const).map((lane) => {
      const worldLane = (this.team === 0 ? lane : -lane) as -1 | 1;
      const t = b.tower(enemy, 'watch', worldLane);
      return { lane, hp: t && !t.dead ? t.hp / t.maxHp : 0 };
    });
    if (Math.abs(towers[0].hp - towers[1].hp) < 0.05) return this.rng.next() < 0.5 ? -1 : 1;
    return towers[0].hp < towers[1].hp ? towers[0].lane : towers[1].lane;
  }

  private tryPush(): boolean {
    const lane = this.pickLane();
    const laneX = lane < 0 ? 3.5 : 14.5;
    const opts = this.affordable().filter((h) => h.card.type === 'troop');
    const win = opts.filter((h) => h.card.tags.includes('win') || h.card.tags.includes('tank'));
    if (win.length) {
      const h = win.reduce((a, c) => (c.card.cost > a.card.cost ? c : a));
      const slow = UNITS[h.card.unit!].speed < 1;
      const spot = slow && this.me.mana >= 9 ? { x: laneX, y: 29.5 } : { x: laneX, y: 18.5 };
      if (this.play(h.i, spot)) {
        this.pending = { at: this.battle.time + (slow ? 4 : 1.5), lane };
        return true;
      }
    }
    if (this.me.mana >= 9.5) {
      const sup = opts.filter((h) => h.card.tags.includes('support') || h.card.tags.includes('swarm') || h.card.tags.includes('air'));
      if (sup.length) {
        const h = this.rng.pick(sup);
        return this.play(h.i, { x: laneX, y: 28.5 });
      }
    }
    return false;
  }

  private trySupport(lane: -1 | 1): boolean {
    const opts = this.affordable().filter(
      (h) => h.card.type === 'troop' && !h.card.tags.includes('win') && !h.card.tags.includes('tank'),
    );
    if (!opts.length) {
      if (this.battle.time > (this.pending?.at ?? 0) + 6) this.pending = null;
      return false;
    }
    // Find our lead unit in that lane.
    const mine = this.battle.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop');
    const lead = mine.map((u) => this.L(u)).filter((p) => (p.x < CENTER_X ? -1 : 1) === lane).sort((a, b) => a.y - b.y)[0];
    const laneX = lane < 0 ? 3.5 : 14.5;
    const spot = lead ? (lead.y > 18 ? { x: lead.x, y: Math.min(30, lead.y + 2) } : { x: laneX, y: 18.5 }) : { x: laneX, y: 18.5 };
    const h = this.rng.pick(opts);
    this.pending = null;
    return this.play(h.i, spot);
  }

  private antiLeak(): void {
    const opts = this.affordable().filter((h) => h.card.type === 'troop');
    if (!opts.length) return;
    const h = opts.reduce((a, c) => (c.card.cost < a.card.cost ? c : a));
    const lane = this.pickLane();
    this.play(h.i, { x: lane < 0 ? 4.5 : 13.5, y: 28.5 });
  }

  // ------------------------------------------------------------ commander power

  private tryPower(): boolean {
    const b = this.battle;
    const id = this.me.power.id!;
    const def = POWERS[id];
    const mine = b.units.filter((u) => !u.dead && u.team === this.team && u.kind === 'troop');
    const threats = this.threats();
    switch (id) {
      case 'rally':
        if (mine.length >= 4 || mine.filter((u) => this.L(u).y < 15).length >= 3) return b.usePower(this.team);
        return false;
      case 'thunder': {
        const foes = b.units.filter((u) => !u.dead && u.team !== this.team && u.kind !== 'tower').sort((a, c) => c.hp - a.hp);
        const top = foes.slice(0, 3).reduce((s, u) => s + u.hp, 0);
        if (top >= 900) return b.usePower(this.team);
        return false;
      }
      case 'frostbreath':
      case 'meteor': {
        const best = this.bestCluster(def.radius!, id === 'meteor' ? 520 : 50, 0.35, id === 'meteor' ? 1.5 : 0, id === 'frostbreath');
        if (best && best.value >= 5) {
          const w = this.L(best.at);
          return b.usePower(this.team, w.x, w.y);
        }
        return false;
      }
      default: {
        // Summons: defend the top threat, or join a push at the bridge.
        if (threats[0]) {
          const f = threats[0].local.reduce((m, p) => (p.y > m.y ? p : m), threats[0].local[0]);
          const w = this.L({ x: f.x, y: Math.min(29, Math.max(18.5, f.y + 2)) });
          return b.usePower(this.team, w.x, w.y);
        }
        if (mine.some((u) => this.L(u).y < 19)) {
          const lane = this.pickLane();
          const w = this.L({ x: lane < 0 ? 3.5 : 14.5, y: 18.5 });
          return b.usePower(this.team, w.x, w.y);
        }
        return false;
      }
    }
  }
}
