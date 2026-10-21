export type Team = 0 | 1; // 0 = player (bottom of the screen), 1 = enemy (top)

export interface Vec {
  x: number;
  y: number;
}

/** What a unit is allowed to attack. */
export type TargetKind = 'ground' | 'both' | 'buildings';
export type CardType = 'troop' | 'building' | 'spell';
export type Rarity = 'common' | 'rare' | 'epic';
export type ProjectileKind = 'arrow' | 'bullet' | 'fire' | 'bolt' | 'cannon' | 'bomb' | 'spark' | 'stone';

export interface UnitStats {
  id: string;
  name: string;
  sprite: string;
  hp: number;
  damage: number;
  /** Seconds between attacks. */
  hitSpeed: number;
  /** Delay before the first attack after locking on (defaults to 40% of hitSpeed). */
  firstHit?: number;
  /** Attack reach, edge to edge, in tiles. */
  range: number;
  /** How far away the unit notices enemies. */
  sight: number;
  /** Tiles per second. */
  speed: number;
  radius: number;
  mass: number;
  flying?: boolean;
  targets: TargetKind;
  /** Splash radius around the impact point. */
  splash?: number;
  /** Splash is centred on the attacker (spinning attacks). */
  selfSplash?: boolean;
  projectile?: { speed: number; kind: ProjectileKind };
  deathDamage?: { damage: number; radius: number };
  deathSpawn?: { unit: string; count: number };
  charge?: { distance: number; speedMul: number; damageMul: number };
  jumpsRiver?: boolean;
  spawn?: { unit: string; interval: number; count: number };
  /** Buildings lose HP over this many seconds. */
  lifetime?: number;
  isBuilding?: boolean;
  /** Visual height in tiles. */
  height: number;
  /** Damage multiplier against towers (spells mostly). */
  towerMul?: number;
  /** Procedural fallback look. */
  look: UnitLook;
}

export interface UnitLook {
  body: string; // main color
  accent?: string;
  shape: 'round' | 'tall' | 'big' | 'beast' | 'flyer' | 'tower' | 'hut' | 'turret' | 'balloon';
  weapon?: 'sword' | 'bow' | 'dagger' | 'fist' | 'gun' | 'staff' | 'axe' | 'lance' | 'none';
}

export interface SpellStats {
  radius: number;
  damage?: number;
  towerMul?: number;
  stun?: number;
  freeze?: number;
  rage?: { duration: number; mul: number };
  /** Heal per second for lingering heal. */
  heal?: number;
  waves?: number;
  /** keep = projectile flies from your keep; instant = lands immediately. */
  travel: 'keep' | 'instant';
  knockback?: number;
  /** Lingering effect duration. */
  duration?: number;
  fx: 'fire' | 'arrows' | 'zap' | 'rage' | 'freeze' | 'heal' | 'meteor' | 'thunder';
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  rarity: Rarity;
  desc: string;
  icon: string;
  unit?: string;
  count?: number;
  formation?: 'single' | 'pair' | 'trio' | 'swarm';
  spell?: SpellStats;
  /** Rough role tags used by the AI. */
  tags: CardTag[];
}

export type CardTag =
  | 'tank'
  | 'win'
  | 'support'
  | 'swarm'
  | 'splash'
  | 'antiair'
  | 'air'
  | 'dps'
  | 'building'
  | 'spell'
  | 'cheap'
  | 'buff';

export type EntityKind = 'troop' | 'building' | 'tower';

export interface BattleMods {
  hpMul: number;
  dmgMul: number;
  manaRate: number;
  startMana: number;
  towerHpMul: number;
  powerRate: number;
  spellMul: number;
}

export const DEFAULT_MODS: BattleMods = {
  hpMul: 1,
  dmgMul: 1,
  manaRate: 1,
  startMana: 5,
  towerHpMul: 1,
  powerRate: 1,
  spellMul: 1,
};

export type BattleEvent =
  | { type: 'deploy'; team: Team; x: number; y: number; card: string }
  | { type: 'spawn'; id: number }
  | { type: 'hit'; x: number; y: number; amount: number; targetId: number; heavy: boolean; air: boolean; fromX?: number; fromY?: number }
  | { type: 'heal'; x: number; y: number; amount: number }
  | { type: 'attack'; id: number; kind: ProjectileKind | 'melee' }
  | { type: 'death'; x: number; y: number; id: number; kind: EntityKind; sprite: string; team: Team; big: boolean }
  | { type: 'tower_down'; team: Team; towerType: 'keep' | 'watch'; x: number; y: number }
  | { type: 'impact'; x: number; y: number; radius: number; fx: string; team: Team }
  | { type: 'spell'; team: Team; x: number; y: number; radius: number; fx: SpellStats['fx'] }
  | { type: 'power'; team: Team; id: string; x?: number; y?: number }
  | { type: 'keep_awake'; team: Team }
  | { type: 'overtime' }
  | { type: 'double_mana' }
  | { type: 'end'; winner: Team | null };
