import {
  ARENA_H,
  ARENA_W,
  CENTER_X,
  RIVER_BOTTOM,
  RIVER_TOP,
  TOWER_SPOTS,
  clamp,
  dist,
  forwardY,
  groundWaypoint,
  inWater,
  resolveWater,
  snapTile,
} from './arena';
import { CARDS, UNITS, levelMul } from './cards';
import { POWERS } from './powers';
import { Rng } from './rng';
import type {
  BattleEvent,
  BattleMods,
  CardDef,
  EntityKind,
  ProjectileKind,
  SpellStats,
  Team,
  UnitStats,
  Vec,
} from './types';
import { DEFAULT_MODS } from './types';

export const REGULATION = 180;
export const OVERTIME = 60;
export const DOUBLE_MANA_AT = 60; // seconds left in regulation
export const MANA_MAX = 10;
export const MANA_PER_SEC = 1 / 2.8;
export const DEPLOY_TIME = 1;

let nextId = 1;

export class Unit {
  id = nextId++;
  team: Team;
  s: UnitStats;
  kind: EntityKind;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  towerType: 'keep' | 'watch' | null = null;
  lane: -1 | 0 | 1 = 0;
  target: Unit | null = null;
  retargetT = 0;
  attackT = 0;
  inRange = false;
  attackAnim = 0;
  deployT = 0;
  stunT = 0;
  freezeT = 0;
  rageT = 0;
  rageMul = 1.4;
  chargeRun = 0;
  charging = false;
  spawnT = 0;
  age = 0;
  facing: 1 | -1 = 1;
  moving = false;
  walkT = Math.random() * 10;
  flash = 0;
  active = true;
  dead = false;
  /** Visual-only hop height while a river-jumper crosses water. */
  hop = 0;
  /** Obstacle currently being walked around, and which side we chose. */
  avoidId = 0;
  avoidSide: 1 | -1 = 1;

  constructor(team: Team, s: UnitStats, kind: EntityKind, level: number, x: number, y: number, mods: BattleMods) {
    this.team = team;
    this.s = s;
    this.kind = kind;
    this.level = level;
    this.x = x;
    this.y = y;
    const lm = levelMul(level);
    const hpMul = kind === 'tower' ? mods.towerHpMul : mods.hpMul;
    this.maxHp = Math.round(s.hp * lm * hpMul);
    this.hp = this.maxHp;
    this.dmg = s.damage * lm * mods.dmgMul;
    this.facing = team === 0 ? 1 : -1;
  }

  get flying(): boolean {
    return !!this.s.flying;
  }
  get isStructure(): boolean {
    return this.kind !== 'troop';
  }
  get disabled(): boolean {
    return this.stunT > 0 || this.freezeT > 0;
  }
}

export interface Projectile {
  id: number;
  team: Team;
  kind: ProjectileKind;
  x: number;
  y: number;
  sx: number;
  sy: number;
  z0: number;
  tx: number;
  ty: number;
  target: Unit | null;
  speed: number;
  damage: number;
  splash: number;
  towerMul: number;
  hitsAir: boolean;
  hitsGround: boolean;
  total: number;
  progress: number;
  spell?: { stats: SpellStats; damage: number };
  dead?: boolean;
}

export interface Effect {
  id: number;
  team: Team;
  kind: 'rage' | 'heal' | 'waves' | 'meteor';
  x: number;
  y: number;
  radius: number;
  t: number;
  duration: number;
  amount: number;
  tick: number;
  count: number;
  towerMul: number;
  dead?: boolean;
}

export interface PlayerState {
  team: Team;
  mana: number;
  deck: string[];
  hand: string[];
  queue: string[];
  levels: Record<string, number>;
  crowns: number;
  power: { id: string | null; charge: number; used: number };
  mods: BattleMods;
  towerLevel: number;
  manaSpent: number;
  damageDealt: number;
}

export interface BattleConfig {
  decks: [string[], string[]];
  levels: [Record<string, number>, Record<string, number>];
  towerLevels: [number, number];
  powers?: [string | null, string | null];
  mods?: [Partial<BattleMods>?, Partial<BattleMods>?];
  regulation?: number;
  overtime?: number;
  seed?: number;
}

export interface BattleResult {
  winner: Team | null;
  crowns: [number, number];
  time: number;
  towerHpFrac: [number, number];
}

export class Battle {
  time = 0;
  phase: 'battle' | 'overtime' | 'ended' = 'battle';
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  effects: Effect[] = [];
  events: BattleEvent[] = [];
  players: [PlayerState, PlayerState];
  result: BattleResult | null = null;
  rng: Rng;
  regulation: number;
  overtime: number;
  doubleMana = false;

  constructor(cfg: BattleConfig) {
    this.rng = new Rng(cfg.seed ?? Date.now());
    this.regulation = cfg.regulation ?? REGULATION;
    this.overtime = cfg.overtime ?? OVERTIME;
    const mk = (team: Team): PlayerState => {
      const mods: BattleMods = { ...DEFAULT_MODS, ...(cfg.mods?.[team] ?? {}) };
      const deck = cfg.decks[team].slice(0, 8);
      const order = this.rng.shuffle(deck.slice());
      return {
        team,
        mana: mods.startMana,
        deck,
        hand: order.slice(0, 4),
        queue: order.slice(4),
        levels: cfg.levels[team],
        crowns: 0,
        power: { id: cfg.powers?.[team] ?? null, charge: 0, used: 0 },
        mods,
        towerLevel: cfg.towerLevels[team],
        manaSpent: 0,
        damageDealt: 0,
      };
    };
    this.players = [mk(0), mk(1)];
    for (const spot of TOWER_SPOTS) {
      const p = this.players[spot.team];
      const u = new Unit(spot.team, UNITS[spot.type], 'tower', p.towerLevel, spot.x, spot.y, p.mods);
      u.towerType = spot.type;
      u.lane = spot.lane;
      u.active = spot.type !== 'keep';
      this.units.push(u);
    }
  }

  // ---------------------------------------------------------------- queries

  timeLeft(): number {
    if (this.phase === 'overtime') return Math.max(0, this.regulation + this.overtime - this.time);
    return Math.max(0, this.regulation - this.time);
  }

  tower(team: Team, type: 'keep' | 'watch', lane: -1 | 0 | 1 = 0): Unit | undefined {
    return this.units.find(
      (u) => u.kind === 'tower' && u.team === team && u.towerType === type && (type === 'keep' || u.lane === lane),
    );
  }

  towers(team: Team): Unit[] {
    return this.units.filter((u) => u.kind === 'tower' && u.team === team && !u.dead);
  }

  nextCard(team: Team): string | undefined {
    return this.players[team].queue[0];
  }

  levelOf(team: Team, cardId: string): number {
    return this.players[team].levels[cardId] ?? 1;
  }

  /**
   * Where a card would land if dropped at (x, y), or null if it can't be placed there.
   * Troops and buildings are snapped to tile centres and clamped into the deploy zone
   * (dragging past the river sticks to its edge, as in the genre).
   */
  placement(team: Team, cardId: string, x: number, y: number): Vec | null {
    const card = CARDS[cardId];
    if (!card) return null;
    if (card.type === 'spell') {
      return { x: clamp(x, 0, ARENA_W), y: clamp(y, 0, ARENA_H) };
    }
    const r = card.unit ? UNITS[card.unit].radius : 0.5;
    let px = snapTile(clamp(x, 0.01, ARENA_W - 0.01));
    let py = snapTile(clamp(y, 0.01, ARENA_H - 0.01));
    const enemy: Team = team === 0 ? 1 : 0;
    const pocketOpen = (lane: -1 | 1) => {
      const t = this.tower(enemy, 'watch', lane);
      return !t || t.dead;
    };
    const laneOf = px < CENTER_X ? -1 : 1;
    if (team === 0) {
      const minY = pocketOpen(laneOf) ? 10.5 : RIVER_BOTTOM + 0.5;
      if (py < minY) py = minY;
    } else {
      const maxY = pocketOpen(laneOf) ? ARENA_H - 10.5 : RIVER_TOP - 0.5;
      if (py > maxY) py = maxY;
    }
    if (inWater(px, py)) py = team === 0 ? RIVER_BOTTOM + 0.5 : RIVER_TOP - 0.5;
    // Never on top of a tower; buildings also can't overlap other structures.
    for (const u of this.units) {
      if (u.dead || !u.isStructure) continue;
      const need = card.type === 'building' ? u.s.radius + r - 0.15 : u.s.radius - 0.1;
      if (dist(u, { x: px, y: py }) < need) return null;
    }
    px = clamp(px, 0.5, ARENA_W - 0.5);
    return { x: px, y: py };
  }

  canPlay(team: Team, handIndex: number): boolean {
    if (this.phase === 'ended') return false;
    const p = this.players[team];
    const id = p.hand[handIndex];
    return !!id && p.mana >= CARDS[id].cost;
  }

  // ---------------------------------------------------------------- actions

  deploy(team: Team, handIndex: number, x: number, y: number): boolean {
    if (!this.canPlay(team, handIndex)) return false;
    const p = this.players[team];
    const id = p.hand[handIndex];
    const card = CARDS[id];
    const pos = this.placement(team, id, x, y);
    if (!pos) return false;
    p.mana -= card.cost;
    p.manaSpent += card.cost;
    // Cycle: the played card goes to the back of the queue.
    p.queue.push(id);
    p.hand[handIndex] = p.queue.shift()!;
    const level = this.levelOf(team, id);
    if (card.type === 'spell') this.castSpell(team, card, pos.x, pos.y, level);
    else this.spawnCard(team, card, pos.x, pos.y, level);
    this.events.push({ type: 'deploy', team, x: pos.x, y: pos.y, card: id });
    return true;
  }

  spawnCard(team: Team, card: CardDef, x: number, y: number, level: number): Unit[] {
    const stats = UNITS[card.unit!];
    const offsets = formationOffsets(card.formation ?? 'single', card.count ?? 1);
    const fy = forwardY(team);
    const out: Unit[] = [];
    for (const o of offsets) {
      const u = this.spawnUnit(team, stats, level, x + o.x, y + o.y * -fy);
      out.push(u);
    }
    return out;
  }

  spawnUnit(team: Team, stats: UnitStats, level: number, x: number, y: number, deploy = DEPLOY_TIME): Unit {
    const p = this.players[team];
    const kind: EntityKind = stats.isBuilding ? 'building' : 'troop';
    const u = new Unit(team, stats, kind, level, clamp(x, 0.4, ARENA_W - 0.4), clamp(y, 0.4, ARENA_H - 0.4), p.mods);
    u.deployT = deploy;
    if (stats.spawn) u.spawnT = 1.5;
    if (!u.flying && !stats.jumpsRiver) resolveWater(u, u.s.radius);
    this.units.push(u);
    this.events.push({ type: 'spawn', id: u.id });
    return u;
  }

  canUsePower(team: Team): boolean {
    const pw = this.players[team].power;
    return this.phase !== 'ended' && !!pw.id && pw.charge >= 1;
  }

  /** Clamp a power target to where it is allowed. */
  powerTarget(team: Team, x: number, y: number): Vec | null {
    const pw = this.players[team].power;
    if (!pw.id) return null;
    const def = POWERS[pw.id];
    if (def.targeting === 'own') {
      const py = team === 0 ? Math.max(y, RIVER_BOTTOM + 0.6) : Math.min(y, RIVER_TOP - 0.6);
      return { x: clamp(x, 1, ARENA_W - 1), y: clamp(py, 1, ARENA_H - 1) };
    }
    return { x: clamp(x, 0, ARENA_W), y: clamp(y, 0, ARENA_H) };
  }

  usePower(team: Team, x = CENTER_X, y = team === 0 ? 24 : 8): boolean {
    if (!this.canUsePower(team)) return false;
    const p = this.players[team];
    const def = POWERS[p.power.id!];
    const pos = def.targeting === 'none' ? { x, y } : this.powerTarget(team, x, y)!;
    p.power.charge = 0;
    p.power.used++;
    const lm = levelMul(p.towerLevel);
    const enemy: Team = team === 0 ? 1 : 0;
    switch (def.id) {
      case 'rally':
        for (const u of this.units) {
          if (u.team === team && u.kind === 'troop' && !u.dead) {
            u.rageT = Math.max(u.rageT, 6);
            u.rageMul = 1.4;
          }
        }
        break;
      case 'imphorde':
        for (const o of formationOffsets('swarm', 5)) this.spawnUnit(team, UNITS.imp, p.towerLevel, pos.x + o.x, pos.y + o.y, 0.6);
        break;
      case 'raisedead':
        for (const o of formationOffsets('swarm', 7)) this.spawnUnit(team, UNITS.skeleton, p.towerLevel, pos.x + o.x, pos.y + o.y, 0.6);
        break;
      case 'bulwark':
        this.spawnUnit(team, UNITS.sentinel, p.towerLevel, pos.x, pos.y, 0.8);
        break;
      case 'frostbreath':
        this.areaEffect(team, pos.x, pos.y, def.radius!, { damage: 50 * lm, towerMul: 0.35, freeze: 3.5 });
        this.events.push({ type: 'spell', team, x: pos.x, y: pos.y, radius: def.radius!, fx: 'freeze' });
        break;
      case 'meteor':
        this.effects.push({
          id: nextId++, team, kind: 'meteor', x: pos.x, y: pos.y, radius: def.radius!, t: 0, duration: 1.4,
          amount: 520 * lm, tick: 0, count: 0, towerMul: 0.35,
        });
        break;
      case 'thunder': {
        const targets = this.units
          .filter((u) => u.team === enemy && !u.dead && u.kind !== 'tower')
          .sort((a, b) => b.hp - a.hp)
          .slice(0, 3);
        for (const t of targets) {
          this.damage(t, 330 * lm, team);
          this.events.push({ type: 'spell', team, x: t.x, y: t.y, radius: 0.9, fx: 'thunder' });
        }
        for (let i = targets.length; i < 3; i++) {
          const towers = this.towers(enemy);
          if (!towers.length) break;
          const t = towers.reduce((a, b) => (a.hp < b.hp ? a : b));
          this.damage(t, 110 * lm, team);
          this.events.push({ type: 'spell', team, x: t.x, y: t.y, radius: 0.9, fx: 'thunder' });
        }
        break;
      }
    }
    this.events.push({ type: 'power', team, id: def.id, x: pos.x, y: pos.y });
    return true;
  }

  // ---------------------------------------------------------------- simulation

  update(dt: number): void {
    if (this.phase === 'ended') return;
    this.time += dt;

    if (this.phase === 'battle') {
      if (!this.doubleMana && this.time >= this.regulation - DOUBLE_MANA_AT) {
        this.doubleMana = true;
        this.events.push({ type: 'double_mana' });
      }
      if (this.time >= this.regulation) {
        const [a, b] = [this.players[0].crowns, this.players[1].crowns];
        if (a !== b) return this.finish(a > b ? 0 : 1);
        if (this.overtime <= 0) return this.tiebreak();
        this.phase = 'overtime';
        this.events.push({ type: 'overtime' });
      }
    } else if (this.phase === 'overtime' && this.time >= this.regulation + this.overtime) {
      return this.tiebreak();
    }

    for (const p of this.players) {
      const rate = MANA_PER_SEC * p.mods.manaRate * (this.doubleMana ? 2 : 1);
      p.mana = Math.min(MANA_MAX, p.mana + rate * dt);
      if (p.power.id) {
        const def = POWERS[p.power.id];
        p.power.charge = Math.min(1, p.power.charge + (dt / def.chargeTime) * p.mods.powerRate);
      }
    }

    for (let i = 0; i < this.units.length; i++) this.updateUnit(this.units[i], dt);
    this.resolveCollisions();
    this.updateProjectiles(dt);
    this.updateEffects(dt);

    this.units = this.units.filter((u) => !u.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.effects = this.effects.filter((e) => !e.dead);
  }

  private updateUnit(u: Unit, dt: number): void {
    if (u.dead) return;
    u.age += dt;
    u.flash = Math.max(0, u.flash - dt);
    u.attackAnim = Math.max(0, u.attackAnim - dt);
    u.stunT = Math.max(0, u.stunT - dt);
    u.freezeT = Math.max(0, u.freezeT - dt);
    u.rageT = Math.max(0, u.rageT - dt);
    u.moving = false;

    if (u.s.lifetime && u.kind === 'building') {
      u.hp -= (u.maxHp / u.s.lifetime) * dt;
      if (u.hp <= 0) {
        this.kill(u, null);
        return;
      }
    }
    if (u.deployT > 0) {
      u.deployT -= dt;
      return;
    }
    if (u.disabled) {
      u.charging = false;
      u.chargeRun = 0;
      u.inRange = false;
      return;
    }
    const mul = u.rageT > 0 ? u.rageMul : 1;

    if (u.s.spawn) {
      u.spawnT -= dt * mul;
      if (u.spawnT <= 0) {
        u.spawnT += u.s.spawn.interval;
        const fy = forwardY(u.team);
        for (let i = 0; i < u.s.spawn.count; i++) {
          this.spawnUnit(u.team, UNITS[u.s.spawn.unit], u.level, u.x + (i - (u.s.spawn.count - 1) / 2) * 0.6, u.y + fy * (u.s.radius + 0.5), 0.3);
        }
      }
    }
    if (u.s.damage <= 0) return;
    if (u.kind === 'tower' && !u.active) return;

    u.walkT += dt * mul;
    u.retargetT -= dt;
    if (!this.validTarget(u, u.target) || (u.retargetT <= 0 && !u.inRange)) {
      u.target = this.findTarget(u);
      u.retargetT = 0.25;
    }
    const t = u.target;
    if (!t) {
      u.inRange = false;
      u.attackT = Math.max(0, u.attackT - dt);
      return;
    }
    const edge = dist(u, t) - u.s.radius - t.s.radius;
    const reach = u.s.range + (u.inRange ? 0.3 : 0);
    if (edge <= reach) {
      if (!u.inRange) {
        u.inRange = true;
        u.attackT = Math.max(u.attackT, u.s.firstHit ?? u.s.hitSpeed * 0.4);
      }
      if (Math.abs(t.x - u.x) > 0.05) u.facing = t.x > u.x ? 1 : -1;
      u.attackT -= dt * mul;
      if (u.attackT <= 0) {
        this.attack(u, t);
        u.attackT += u.s.hitSpeed;
        if (u.attackT < 0) u.attackT = u.s.hitSpeed * 0.5;
      }
      return;
    }
    u.inRange = false;
    u.attackT = Math.max(0, u.attackT - dt);
    if (u.s.speed <= 0) return;

    // Move.
    const jumper = !!u.s.jumpsRiver;
    let wp = u.flying || jumper ? { x: t.x, y: t.y } : groundWaypoint(u, t, u.s.radius);
    if (!u.flying) wp = this.steerAround(u, wp, t);
    let dx = wp.x - u.x;
    let dy = wp.y - u.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    let speed = u.s.speed * mul;
    if (u.s.charge) {
      if (u.charging) speed *= u.s.charge.speedMul;
    }
    let step = speed * dt;
    if (wp.x === t.x && wp.y === t.y) step = Math.min(step, Math.max(0, edge - u.s.range * 0.5) + 0.02);
    u.x += dx * step;
    u.y += dy * step;
    u.moving = step > 0.0001;
    if (Math.abs(dx) > 0.15) u.facing = dx > 0 ? 1 : -1;
    if (u.s.charge && !u.charging) {
      u.chargeRun += step;
      if (u.chargeRun >= u.s.charge.distance) u.charging = true;
    }
    if (jumper) u.hop = u.y > RIVER_TOP - 0.6 && u.y < RIVER_BOTTOM + 0.6 ? 1 : 0;
  }

  /**
   * Steer a ground unit around towers and buildings that block the straight line to its
   * waypoint (e.g. a troop dropped directly behind its own tower). Picks a side once per
   * obstacle and sticks with it so the unit doesn't dither.
   */
  private steerAround(u: Unit, wp: Vec, target: Unit): Vec {
    const dx = wp.x - u.x;
    const dy = wp.y - u.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return wp;
    const nx = dx / len;
    const ny = dy / len;
    let block: Unit | null = null;
    let bestT = Infinity;
    for (const o of this.units) {
      if (o.dead || !o.isStructure || o === target) continue;
      const R = o.s.radius + u.s.radius + 0.05;
      const ox = o.x - u.x;
      const oy = o.y - u.y;
      const along = ox * nx + oy * ny;
      if (along < -0.2 || along > len + R) continue;
      if (Math.abs(ox * ny - oy * nx) >= R) continue;
      if (along < bestT) {
        bestT = along;
        block = o;
      }
    }
    if (!block) {
      u.avoidId = 0;
      return wp;
    }
    // Lateral offset of the obstacle along the path's left normal (-ny, nx).
    const lx = -ny;
    const ly = nx;
    const lat = (block.x - u.x) * lx + (block.y - u.y) * ly;
    if (u.avoidId !== block.id) {
      u.avoidId = block.id;
      if (Math.abs(lat) > 0.2) u.avoidSide = lat > 0 ? -1 : 1;
      else {
        // Dead ahead: go round on the side nearer the arena centre (more room, natural flow).
        const leftX = block.x + lx * (block.s.radius + u.s.radius);
        const rightX = block.x - lx * (block.s.radius + u.s.radius);
        u.avoidSide = Math.abs(leftX - CENTER_X) <= Math.abs(rightX - CENTER_X) ? 1 : -1;
      }
      const R = block.s.radius + u.s.radius + 0.4;
      const px = block.x + lx * R * u.avoidSide;
      if (px < u.s.radius || px > ARENA_W - u.s.radius) u.avoidSide = -u.avoidSide as 1 | -1;
    }
    const R = block.s.radius + u.s.radius + 0.4;
    // Aim beside the obstacle, slightly past its centre along the path.
    return {
      x: block.x + lx * R * u.avoidSide + nx * 0.6,
      y: block.y + ly * R * u.avoidSide + ny * 0.6,
    };
  }

  private validTarget(u: Unit, t: Unit | null): boolean {
    if (!t || t.dead) return false;
    if (!this.canTarget(u, t)) return false;
    if (u.isStructure) return dist(u, t) - u.s.radius - t.s.radius <= u.s.range + 0.3;
    return true;
  }

  canTarget(u: Unit, t: Unit): boolean {
    if (t.dead || t.team === u.team) return false;
    if (u.s.targets === 'buildings') return t.isStructure;
    if (t.flying) return u.s.targets === 'both';
    return true;
  }

  /** The tower a troop marches on when nothing else is in sight. */
  laneTower(u: Unit): Unit | null {
    const enemy: Team = u.team === 0 ? 1 : 0;
    const lane: -1 | 1 = u.x < CENTER_X ? -1 : 1;
    const w = this.tower(enemy, 'watch', lane);
    if (w && !w.dead) return w;
    const k = this.tower(enemy, 'keep');
    if (k && !k.dead) return k;
    const others = this.towers(enemy);
    return others[0] ?? null;
  }

  findTarget(u: Unit): Unit | null {
    if (u.s.targets === 'buildings') {
      let best = this.laneTower(u);
      let bestD = best ? dist(u, best) : Infinity;
      for (const e of this.units) {
        if (e.dead || e.team === u.team || e.kind !== 'building') continue;
        const d = dist(u, e);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      return best;
    }
    let best: Unit | null = null;
    let bestD = u.isStructure ? u.s.range : u.s.sight;
    for (const e of this.units) {
      if (!this.canTarget(u, e)) continue;
      const d = dist(u, e) - u.s.radius - e.s.radius;
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    if (best || u.isStructure) return best;
    return this.laneTower(u);
  }

  private attack(u: Unit, t: Unit): void {
    u.attackAnim = 0.28;
    let dmg = u.dmg;
    if (u.s.charge && u.charging) {
      dmg *= u.s.charge.damageMul;
      u.charging = false;
      u.chargeRun = 0;
    }
    if (u.s.projectile) {
      const pr = u.s.projectile;
      const z0 = u.kind === 'tower' ? u.s.height * 0.8 : u.flying ? 1.6 : u.s.height * 0.55;
      const total = Math.max(0.1, dist(u, t));
      this.projectiles.push({
        id: nextId++, team: u.team, kind: pr.kind, x: u.x, y: u.y, sx: u.x, sy: u.y, z0,
        tx: t.x, ty: t.y, target: t, speed: pr.speed, damage: dmg, splash: u.s.splash ?? 0,
        towerMul: u.s.towerMul ?? 1, hitsAir: u.s.targets === 'both', hitsGround: true, total, progress: 0,
      });
      this.events.push({ type: 'attack', id: u.id, kind: pr.kind });
      return;
    }
    this.events.push({ type: 'attack', id: u.id, kind: 'melee' });
    if (u.s.splash) {
      const cx = u.s.selfSplash ? u.x : t.x;
      const cy = u.s.selfSplash ? u.y : t.y;
      const bomber = u.flying && u.s.targets === 'buildings';
      this.splash(u.team, cx, cy, u.s.splash, dmg, u.s.towerMul ?? 1, bomber ? false : u.s.targets === 'both', true);
      if (bomber) this.events.push({ type: 'impact', x: cx, y: cy, radius: u.s.splash, fx: 'bomb', team: u.team });
      else if (u.s.selfSplash) this.events.push({ type: 'impact', x: cx, y: cy, radius: u.s.splash, fx: 'spin', team: u.team });
      return;
    }
    if (u.flying && u.s.targets === 'buildings') {
      // Bomber: bombs splash a little around the building.
      this.splash(u.team, t.x, t.y, 1.2, dmg, 1, false, true);
      this.events.push({ type: 'impact', x: t.x, y: t.y, radius: 1.2, fx: 'bomb', team: u.team });
      return;
    }
    this.damage(t, dmg, u.team, true, u);
  }

  /** Damage enemies of `team` within radius. */
  splash(team: Team, x: number, y: number, radius: number, dmg: number, towerMul: number, hitsAir: boolean, hitsGround: boolean): void {
    for (const e of this.units) {
      if (e.dead || e.team === team) continue;
      if (e.flying ? !hitsAir : !hitsGround) continue;
      if (dist(e, { x, y }) <= radius + e.s.radius * 0.7) {
        this.damage(e, e.kind === 'tower' ? dmg * towerMul : dmg, team, false, { x, y });
      }
    }
  }

  /** `src` is where the blow came from (attacker or blast centre); it only steers the hit reaction. */
  damage(t: Unit, amount: number, by: Team, heavy = false, src?: { x: number; y: number }): void {
    if (t.dead || amount <= 0) return;
    t.hp -= amount;
    t.flash = 0.12;
    this.players[by].damageDealt += amount;
    this.events.push({ type: 'hit', x: t.x, y: t.y, amount: Math.round(amount), targetId: t.id, heavy: heavy || amount > 200, air: t.flying, fromX: src?.x, fromY: src?.y });
    if (t.kind === 'tower' && t.towerType === 'keep' && !t.active) this.wakeKeep(t.team);
    if (t.hp <= 0) this.kill(t, by);
  }

  heal(t: Unit, amount: number): void {
    if (t.dead) return;
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + amount);
    if (t.hp > before) this.events.push({ type: 'heal', x: t.x, y: t.y, amount: t.hp - before });
  }

  private wakeKeep(team: Team): void {
    const k = this.tower(team, 'keep');
    if (k && !k.active && !k.dead) {
      k.active = true;
      this.events.push({ type: 'keep_awake', team });
    }
  }

  kill(u: Unit, by: Team | null): void {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    this.events.push({
      type: 'death', x: u.x, y: u.y, id: u.id, kind: u.kind, sprite: u.s.sprite, team: u.team,
      big: u.s.radius >= 0.7 || u.kind !== 'troop',
    });
    if (u.s.deathDamage) {
      const dd = u.s.deathDamage;
      this.splash(u.team, u.x, u.y, dd.radius, dd.damage * levelMul(u.level), 1, false, true);
      this.events.push({ type: 'impact', x: u.x, y: u.y, radius: dd.radius, fx: 'bomb', team: u.team });
    }
    if (u.s.deathSpawn) {
      for (let i = 0; i < u.s.deathSpawn.count; i++) {
        this.spawnUnit(u.team, UNITS[u.s.deathSpawn.unit], u.level, u.x + (i - 0.5) * 0.5, u.y, 0.2);
      }
    }
    if (u.kind === 'tower') {
      const winner: Team = u.team === 0 ? 1 : 0;
      this.events.push({ type: 'tower_down', team: u.team, towerType: u.towerType!, x: u.x, y: u.y });
      if (u.towerType === 'keep') {
        this.players[winner].crowns = 3;
        this.finish(winner);
      } else {
        this.players[winner].crowns = Math.min(3, this.players[winner].crowns + 1);
        this.wakeKeep(u.team);
        if (this.phase === 'overtime') this.finish(winner);
      }
    }
    void by;
  }

  private resolveCollisions(): void {
    const us = this.units;
    const n = us.length;
    for (let i = 0; i < n; i++) {
      const a = us[i];
      if (a.dead) continue;
      for (let j = i + 1; j < n; j++) {
        const b = us[j];
        if (b.dead) continue;
        if (a.flying !== b.flying) continue;
        const aStatic = a.isStructure;
        const bStatic = b.isStructure;
        if (aStatic && bStatic) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const minD = a.s.radius + b.s.radius;
        if (d >= minD) continue;
        if (d < 1e-4) {
          dx = (Math.random() - 0.5) * 0.01;
          dy = 0.01;
          d = Math.hypot(dx, dy);
        }
        const overlap = minD - d;
        const nx = dx / d;
        const ny = dy / d;
        if (aStatic) {
          b.x += nx * overlap;
          b.y += ny * overlap;
        } else if (bStatic) {
          a.x -= nx * overlap;
          a.y -= ny * overlap;
        } else {
          // Units still deploying are treated as heavy so crowds don't shove fresh drops around.
          const ma = a.s.mass * (a.deployT > 0 ? 4 : 1);
          const mb = b.s.mass * (b.deployT > 0 ? 4 : 1);
          const k = 0.6 * overlap;
          a.x -= nx * k * (mb / (ma + mb));
          a.y -= ny * k * (mb / (ma + mb));
          b.x += nx * k * (ma / (ma + mb));
          b.y += ny * k * (ma / (ma + mb));
        }
      }
    }
    for (const u of us) {
      if (u.dead || u.isStructure) continue;
      if (!u.flying && !u.s.jumpsRiver) resolveWater(u, u.s.radius);
      u.x = clamp(u.x, u.s.radius * 0.5, ARENA_W - u.s.radius * 0.5);
      u.y = clamp(u.y, u.s.radius * 0.5, ARENA_H - u.s.radius * 0.5);
    }
  }

  // ---------------------------------------------------------------- spells

  castSpell(team: Team, card: CardDef, x: number, y: number, level: number): void {
    const sp = card.spell!;
    const p = this.players[team];
    const dmg = (sp.damage ?? 0) * levelMul(level) * p.mods.spellMul;
    if (sp.travel === 'keep') {
      const keep = this.tower(team, 'keep');
      const sx = keep && !keep.dead ? keep.x : CENTER_X;
      const sy = keep && !keep.dead ? keep.y : team === 0 ? ARENA_H - 2 : 2;
      const total = Math.max(0.1, Math.hypot(x - sx, y - sy));
      this.projectiles.push({
        id: nextId++, team, kind: sp.fx === 'arrows' ? 'arrow' : 'fire', x: sx, y: sy, sx, sy, z0: 3,
        tx: x, ty: y, target: null, speed: sp.fx === 'arrows' ? 17 : 13, damage: dmg, splash: sp.radius,
        towerMul: sp.towerMul ?? 1, hitsAir: true, hitsGround: true, total, progress: 0,
        spell: { stats: sp, damage: dmg },
      });
      this.events.push({ type: 'spell', team, x, y, radius: sp.radius, fx: sp.fx });
      return;
    }
    this.spellImpact(team, sp, x, y, dmg, level);
  }

  private spellImpact(team: Team, sp: SpellStats, x: number, y: number, dmg: number, level: number): void {
    if (sp.waves && sp.waves > 1) {
      this.effects.push({
        id: nextId++, team, kind: 'waves', x, y, radius: sp.radius, t: 0, duration: 0.5,
        amount: dmg / sp.waves, tick: 0, count: sp.waves, towerMul: sp.towerMul ?? 1,
      });
      return;
    }
    if (sp.rage) {
      this.effects.push({
        id: nextId++, team, kind: 'rage', x, y, radius: sp.radius, t: 0, duration: sp.duration ?? 6,
        amount: sp.rage.mul, tick: 0, count: 0, towerMul: 1,
      });
      this.events.push({ type: 'spell', team, x, y, radius: sp.radius, fx: sp.fx });
      return;
    }
    if (sp.heal) {
      this.effects.push({
        id: nextId++, team, kind: 'heal', x, y, radius: sp.radius, t: 0, duration: sp.duration ?? 2,
        amount: sp.heal * levelMul(level), tick: 0, count: 0, towerMul: 1,
      });
      this.events.push({ type: 'spell', team, x, y, radius: sp.radius, fx: sp.fx });
      return;
    }
    this.areaEffect(team, x, y, sp.radius, { damage: dmg, towerMul: sp.towerMul ?? 1, stun: sp.stun, freeze: sp.freeze, knockback: sp.knockback });
    if (sp.travel === 'instant') this.events.push({ type: 'spell', team, x, y, radius: sp.radius, fx: sp.fx });
    this.events.push({ type: 'impact', x, y, radius: sp.radius, fx: sp.fx, team });
  }

  areaEffect(
    team: Team,
    x: number,
    y: number,
    radius: number,
    o: { damage?: number; towerMul?: number; stun?: number; freeze?: number; knockback?: number },
  ): void {
    for (const e of this.units) {
      if (e.dead || e.team === team) continue;
      const d = dist(e, { x, y });
      if (d > radius + e.s.radius * 0.7) continue;
      if (o.damage) this.damage(e, e.kind === 'tower' ? o.damage * (o.towerMul ?? 1) : o.damage, team, false, { x, y });
      if (e.dead) continue;
      if (o.stun && e.kind !== 'tower') {
        e.stunT = Math.max(e.stunT, o.stun);
        e.attackT = Math.max(e.attackT, 0.3);
      }
      if (o.stun && e.kind === 'tower') e.attackT = Math.max(e.attackT, o.stun);
      if (o.freeze) {
        e.freezeT = Math.max(e.freezeT, o.freeze);
      }
      if (o.knockback && e.kind === 'troop' && e.s.mass < 12 && !e.flying) {
        const k = o.knockback * (1 - d / (radius + 1));
        const nx = (e.x - x) / (d || 1);
        const ny = (e.y - y) / (d || 1);
        e.x += nx * k;
        e.y += ny * k;
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.target && !p.target.dead) {
        p.tx = p.target.x;
        p.ty = p.target.y;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step + 0.05) {
        p.x = p.tx;
        p.y = p.ty;
        p.progress = 1;
        p.dead = true;
        this.projectileImpact(p);
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      const travelled = Math.hypot(p.x - p.sx, p.y - p.sy);
      p.progress = Math.min(1, travelled / Math.max(0.1, travelled + d));
    }
  }

  private projectileImpact(p: Projectile): void {
    if (p.spell) {
      this.spellImpact(p.team, p.spell.stats, p.tx, p.ty, p.spell.damage, 1);
      return;
    }
    if (p.splash > 0) {
      this.splash(p.team, p.tx, p.ty, p.splash, p.damage, p.towerMul, p.hitsAir, p.hitsGround);
      this.events.push({ type: 'impact', x: p.tx, y: p.ty, radius: p.splash, fx: p.kind, team: p.team });
      return;
    }
    const t = p.target;
    if (t && !t.dead) this.damage(t, t.kind === 'tower' ? p.damage * p.towerMul : p.damage, p.team, false, { x: p.sx, y: p.sy });
  }

  private updateEffects(dt: number): void {
    for (const e of this.effects) {
      if (e.dead) continue;
      e.t += dt;
      switch (e.kind) {
        case 'waves': {
          e.tick -= dt;
          if (e.tick <= 0 && e.count > 0) {
            e.tick = 0.22;
            e.count--;
            this.areaEffect(e.team, e.x, e.y, e.radius, { damage: e.amount, towerMul: e.towerMul });
            this.events.push({ type: 'impact', x: e.x, y: e.y, radius: e.radius, fx: 'arrows', team: e.team });
          }
          if (e.count <= 0) e.dead = true;
          break;
        }
        case 'rage':
          for (const u of this.units) {
            if (u.dead || u.team !== e.team || u.kind === 'tower') continue;
            if (dist(u, e) <= e.radius + u.s.radius) {
              u.rageT = Math.max(u.rageT, 2);
              u.rageMul = e.amount;
            }
          }
          if (e.t >= e.duration) e.dead = true;
          break;
        case 'heal':
          e.tick -= dt;
          for (const u of this.units) {
            if (u.dead || u.team !== e.team || u.kind === 'tower') continue;
            if (dist(u, e) <= e.radius + u.s.radius) {
              const before = u.hp;
              u.hp = Math.min(u.maxHp, u.hp + e.amount * dt);
              if (e.tick <= 0 && u.hp > before) this.events.push({ type: 'heal', x: u.x, y: u.y, amount: Math.round(e.amount * 0.4) });
            }
          }
          if (e.tick <= 0) e.tick = 0.4;
          if (e.t >= e.duration) e.dead = true;
          break;
        case 'meteor':
          if (e.t >= e.duration) {
            e.dead = true;
            this.areaEffect(e.team, e.x, e.y, e.radius, { damage: e.amount, towerMul: e.towerMul, knockback: 1.5 });
            this.events.push({ type: 'impact', x: e.x, y: e.y, radius: e.radius, fx: 'meteor', team: e.team });
          }
          break;
      }
    }
  }

  // ---------------------------------------------------------------- end of battle

  private towerHpFrac(team: Team): number {
    // Compare surviving towers; counting destroyed towers as zero forces a draw
    // whenever both teams have already taken a crown.
    let min = 1;
    for (const spot of TOWER_SPOTS) {
      if (spot.team !== team) continue;
      const t = this.units.find((u) => u.kind === 'tower' && u.team === team && u.towerType === spot.type && u.lane === spot.lane);
      if (!t || t.dead) continue;
      const f = t.hp / t.maxHp;
      if (f < min) min = f;
    }
    return min;
  }

  /** Give up: the other side wins with three crowns. */
  forfeit(team: Team): void {
    if (this.phase === 'ended') return;
    const winner: Team = team === 0 ? 1 : 0;
    this.players[winner].crowns = 3;
    this.finish(winner);
  }

  private tiebreak(): void {
    const a = this.towerHpFrac(0);
    const b = this.towerHpFrac(1);
    if (Math.abs(a - b) < 0.001) return this.finish(null);
    this.finish(a > b ? 0 : 1);
  }

  private finish(winner: Team | null): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.result = {
      winner,
      crowns: [this.players[0].crowns, this.players[1].crowns],
      time: this.time,
      towerHpFrac: [this.towerHpFrac(0), this.towerHpFrac(1)],
    };
    this.events.push({ type: 'end', winner });
  }
}

export function formationOffsets(f: 'single' | 'pair' | 'trio' | 'swarm', count: number): Vec[] {
  switch (f) {
    case 'pair':
      return [
        { x: -0.6, y: 0 },
        { x: 0.6, y: 0 },
      ];
    case 'trio':
      return [
        { x: 0, y: 0.5 },
        { x: -0.6, y: -0.4 },
        { x: 0.6, y: -0.4 },
      ];
    case 'swarm': {
      const out: Vec[] = [{ x: 0, y: 0 }];
      const ring1 = Math.min(count - 1, 6);
      for (let i = 0; i < ring1; i++) {
        const a = (i / ring1) * Math.PI * 2;
        out.push({ x: Math.cos(a) * 0.75, y: Math.sin(a) * 0.75 });
      }
      const ring2 = count - 1 - ring1;
      for (let i = 0; i < ring2; i++) {
        const a = (i / ring2) * Math.PI * 2 + 0.4;
        out.push({ x: Math.cos(a) * 1.4, y: Math.sin(a) * 1.4 });
      }
      return out;
    }
    default:
      return [{ x: 0, y: 0 }];
  }
}
