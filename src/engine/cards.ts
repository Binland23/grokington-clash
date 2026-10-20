import type { CardDef, UnitStats } from './types';

export const MAX_LEVEL = 10;
export const LEVEL_STEP = 1.1;

export function levelMul(level: number): number {
  return Math.pow(LEVEL_STEP, Math.max(0, level - 1));
}

const MELEE = 0.5;

export const UNITS: Record<string, UnitStats> = {
  knight: {
    id: 'knight', name: 'Knight', sprite: 'unit_knight',
    hp: 830, damage: 92, hitSpeed: 1.2, range: MELEE, sight: 5.5, speed: 1.0,
    radius: 0.45, mass: 6, targets: 'ground', height: 1.75,
    look: { body: '#c9d1dc', accent: '#2f6bff', shape: 'round', weapon: 'sword' },
  },
  archer: {
    id: 'archer', name: 'Archer', sprite: 'unit_archer',
    hp: 150, damage: 44, hitSpeed: 0.9, range: 5, sight: 5.5, speed: 1.0,
    radius: 0.35, mass: 2, targets: 'both', height: 1.45,
    projectile: { speed: 13, kind: 'arrow' },
    look: { body: '#ff8fb8', accent: '#2f6bff', shape: 'tall', weapon: 'bow' },
  },
  imp: {
    id: 'imp', name: 'Imp', sprite: 'unit_imp',
    hp: 100, damage: 56, hitSpeed: 1.1, range: MELEE, sight: 5.5, speed: 2.0,
    radius: 0.3, mass: 1.5, targets: 'ground', height: 1.1,
    look: { body: '#6bcf4f', accent: '#2f6bff', shape: 'round', weapon: 'dagger' },
  },
  brute: {
    id: 'brute', name: 'Boulder Brute', sprite: 'unit_brute',
    hp: 2550, damage: 155, hitSpeed: 1.5, range: MELEE + 0.2, sight: 7.5, speed: 0.75,
    radius: 0.75, mass: 18, targets: 'buildings', height: 2.6,
    look: { body: '#8d8f96', accent: '#2f6bff', shape: 'big', weapon: 'fist' },
  },
  ironclad: {
    id: 'ironclad', name: 'Ironclad', sprite: 'unit_ironclad',
    hp: 700, damage: 360, hitSpeed: 1.7, firstHit: 0.5, range: MELEE + 0.3, sight: 5.5, speed: 1.5,
    radius: 0.45, mass: 5, targets: 'ground', height: 1.7,
    look: { body: '#4a5160', accent: '#2f6bff', shape: 'round', weapon: 'sword' },
  },
  gunner: {
    id: 'gunner', name: 'Dwarf Gunner', sprite: 'unit_gunner',
    hp: 390, damage: 106, hitSpeed: 1.05, range: 6, sight: 6.5, speed: 1.0,
    radius: 0.42, mass: 4, targets: 'both', height: 1.5,
    projectile: { speed: 16, kind: 'bullet' },
    look: { body: '#b5713d', accent: '#2f6bff', shape: 'round', weapon: 'gun' },
  },
  wyrmling: {
    id: 'wyrmling', name: 'Wyrmling', sprite: 'unit_wyrmling',
    hp: 640, damage: 78, hitSpeed: 1.5, range: 3.5, sight: 5.5, speed: 1.5,
    radius: 0.55, mass: 4, flying: true, targets: 'both', splash: 1.1, height: 1.7,
    projectile: { speed: 9, kind: 'fire' },
    look: { body: '#3a7bff', accent: '#ffd54a', shape: 'flyer', weapon: 'none' },
  },
  skeleton: {
    id: 'skeleton', name: 'Skeleton', sprite: 'unit_skeleton',
    hp: 38, damage: 38, hitSpeed: 1.0, range: MELEE, sight: 5, speed: 1.5,
    radius: 0.28, mass: 1, targets: 'ground', height: 1.0,
    look: { body: '#f1ead6', accent: '#2f6bff', shape: 'round', weapon: 'sword' },
  },
  boarrider: {
    id: 'boarrider', name: 'Boar Rider', sprite: 'unit_boarrider',
    hp: 900, damage: 170, hitSpeed: 1.6, range: MELEE + 0.2, sight: 9, speed: 2.0,
    radius: 0.6, mass: 7, targets: 'buildings', jumpsRiver: true, height: 1.9,
    look: { body: '#8a5a3c', accent: '#2f6bff', shape: 'beast', weapon: 'fist' },
  },
  pyromancer: {
    id: 'pyromancer', name: 'Pyromancer', sprite: 'unit_pyromancer',
    hp: 400, damage: 150, hitSpeed: 1.4, range: 5.5, sight: 5.5, speed: 1.0,
    radius: 0.42, mass: 4, targets: 'both', splash: 1.2, height: 1.75,
    projectile: { speed: 10, kind: 'fire' },
    look: { body: '#2f6bff', accent: '#ffb347', shape: 'tall', weapon: 'staff' },
  },
  berserker: {
    id: 'berserker', name: 'Berserker', sprite: 'unit_berserker',
    hp: 1100, damage: 135, hitSpeed: 1.5, range: MELEE + 0.2, sight: 5.5, speed: 1.0,
    radius: 0.48, mass: 7, targets: 'ground', splash: 1.6, selfSplash: true, height: 1.7,
    look: { body: '#d9573a', accent: '#2f6bff', shape: 'round', weapon: 'axe' },
  },
  gargoyle: {
    id: 'gargoyle', name: 'Gargoyle', sprite: 'unit_gargoyle',
    hp: 110, damage: 46, hitSpeed: 1.0, range: 1.6, sight: 5.5, speed: 2.0,
    radius: 0.35, mass: 1.5, flying: true, targets: 'both', height: 1.15,
    look: { body: '#7d8494', accent: '#2f6bff', shape: 'flyer', weapon: 'none' },
  },
  blimp: {
    id: 'blimp', name: 'Bomb Blimp', sprite: 'unit_blimp',
    hp: 1000, damage: 460, hitSpeed: 3.0, firstHit: 1.0, range: 0.3, sight: 9, speed: 1.0,
    radius: 0.7, mass: 8, flying: true, targets: 'buildings', height: 2.4,
    deathDamage: { damage: 180, radius: 2.0 },
    look: { body: '#2f6bff', accent: '#ffd54a', shape: 'balloon', weapon: 'none' },
  },
  lancer: {
    id: 'lancer', name: 'Lancer', sprite: 'unit_lancer',
    hp: 1060, damage: 215, hitSpeed: 1.4, range: MELEE + 0.6, sight: 5.5, speed: 1.0,
    radius: 0.6, mass: 9, targets: 'ground', height: 2.2,
    charge: { distance: 2.5, speedMul: 2, damageMul: 2 },
    look: { body: '#f1f1f1', accent: '#2f6bff', shape: 'beast', weapon: 'lance' },
  },
  turret: {
    id: 'turret', name: 'Bolt Turret', sprite: 'bld_turret',
    hp: 620, damage: 92, hitSpeed: 0.9, range: 5.5, sight: 5.5, speed: 0,
    radius: 0.95, mass: 1000, targets: 'ground', isBuilding: true, lifetime: 30, height: 2.1,
    projectile: { speed: 15, kind: 'bolt' },
    look: { body: '#8b6a45', accent: '#2f6bff', shape: 'turret', weapon: 'none' },
  },
  imphut: {
    id: 'imphut', name: 'Imp Hut', sprite: 'bld_imphut',
    hp: 900, damage: 0, hitSpeed: 1, range: 0, sight: 0, speed: 0,
    radius: 1.05, mass: 1000, targets: 'ground', isBuilding: true, lifetime: 40, height: 2.3,
    spawn: { unit: 'imp', interval: 4.2, count: 1 },
    look: { body: '#9a7448', accent: '#2f6bff', shape: 'hut', weapon: 'none' },
  },
  sentinel: {
    id: 'sentinel', name: 'Stone Sentinel', sprite: 'unit_brute',
    hp: 1800, damage: 60, hitSpeed: 1.2, range: MELEE + 0.2, sight: 5, speed: 0,
    radius: 0.9, mass: 1000, targets: 'ground', isBuilding: true, lifetime: 20, height: 2.4,
    look: { body: '#9a9ca3', accent: '#2f6bff', shape: 'big', weapon: 'fist' },
  },
  watch: {
    id: 'watch', name: 'Watchtower', sprite: 'tower_watch',
    hp: 1500, damage: 52, hitSpeed: 0.8, range: 7.5, sight: 7.5, speed: 0,
    radius: 1.5, mass: 1000, targets: 'both', isBuilding: true, height: 3.9,
    projectile: { speed: 15, kind: 'arrow' },
    look: { body: '#a7a39a', accent: '#2f6bff', shape: 'tower', weapon: 'bow' },
  },
  keep: {
    id: 'keep', name: 'Keep', sprite: 'tower_keep',
    hp: 2600, damage: 64, hitSpeed: 1.0, range: 7, sight: 7, speed: 0,
    radius: 2, mass: 1000, targets: 'both', isBuilding: true, height: 4.6,
    projectile: { speed: 13, kind: 'cannon' },
    look: { body: '#a7a39a', accent: '#2f6bff', shape: 'tower', weapon: 'none' },
  },
};

export const CARDS: Record<string, CardDef> = {
  knight: {
    id: 'knight', name: 'Knight', type: 'troop', cost: 3, rarity: 'common', unit: 'knight', count: 1,
    icon: 'unit_knight', desc: 'A sturdy swordsman who soaks up hits and hits back.', tags: ['tank', 'cheap'],
  },
  archers: {
    id: 'archers', name: 'Archer Duo', type: 'troop', cost: 3, rarity: 'common', unit: 'archer', count: 2,
    formation: 'pair', icon: 'unit_archer', desc: 'Two sharpshooters. Hit air and ground from range.', tags: ['support', 'antiair'],
  },
  imps: {
    id: 'imps', name: 'Imp Gang', type: 'troop', cost: 2, rarity: 'common', unit: 'imp', count: 3,
    formation: 'trio', icon: 'unit_imp', desc: 'Three speedy little stabbers.', tags: ['swarm', 'cheap', 'dps'],
  },
  brute: {
    id: 'brute', name: 'Boulder Brute', type: 'troop', cost: 5, rarity: 'rare', unit: 'brute', count: 1,
    icon: 'unit_brute', desc: 'A walking mountain. Ignores troops and pounds buildings.', tags: ['tank', 'win'],
  },
  ironclad: {
    id: 'ironclad', name: 'Ironclad', type: 'troop', cost: 4, rarity: 'rare', unit: 'ironclad', count: 1,
    icon: 'unit_ironclad', desc: 'Slow swings, enormous damage. Melts tanks.', tags: ['dps'],
  },
  gunner: {
    id: 'gunner', name: 'Dwarf Gunner', type: 'troop', cost: 4, rarity: 'rare', unit: 'gunner', count: 1,
    icon: 'unit_gunner', desc: 'Long-range blunderbuss. Shoots air and ground.', tags: ['support', 'antiair', 'dps'],
  },
  wyrmling: {
    id: 'wyrmling', name: 'Wyrmling', type: 'troop', cost: 4, rarity: 'epic', unit: 'wyrmling', count: 1,
    icon: 'unit_wyrmling', desc: 'A flying baby dragon that breathes splash fire.', tags: ['air', 'splash', 'antiair'],
  },
  boneswarm: {
    id: 'boneswarm', name: 'Bone Swarm', type: 'troop', cost: 3, rarity: 'epic', unit: 'skeleton', count: 10,
    formation: 'swarm', icon: 'unit_skeleton', desc: 'Ten rattling skeletons. Overwhelm big targets.', tags: ['swarm', 'dps'],
  },
  boarrider: {
    id: 'boarrider', name: 'Boar Rider', type: 'troop', cost: 4, rarity: 'rare', unit: 'boarrider', count: 1,
    icon: 'unit_boarrider', desc: 'Leaps the river and charges straight for buildings.', tags: ['win'],
  },
  pyromancer: {
    id: 'pyromancer', name: 'Pyromancer', type: 'troop', cost: 5, rarity: 'rare', unit: 'pyromancer', count: 1,
    icon: 'unit_pyromancer', desc: 'Hurls fireballs that splash crowds, air or ground.', tags: ['support', 'splash', 'antiair'],
  },
  berserker: {
    id: 'berserker', name: 'Berserker', type: 'troop', cost: 4, rarity: 'rare', unit: 'berserker', count: 1,
    icon: 'unit_berserker', desc: 'Spins her axe, hitting everything around her.', tags: ['tank', 'splash'],
  },
  gargoyles: {
    id: 'gargoyles', name: 'Gargoyles', type: 'troop', cost: 3, rarity: 'common', unit: 'gargoyle', count: 3,
    formation: 'trio', icon: 'unit_gargoyle', desc: 'Three stone fliers that swoop on anything.', tags: ['air', 'swarm', 'antiair'],
  },
  blimp: {
    id: 'blimp', name: 'Bomb Blimp', type: 'troop', cost: 5, rarity: 'epic', unit: 'blimp', count: 1,
    icon: 'unit_blimp', desc: 'Floats to buildings and drops huge bombs. Explodes when popped.', tags: ['win', 'air'],
  },
  lancer: {
    id: 'lancer', name: 'Lancer', type: 'troop', cost: 5, rarity: 'epic', unit: 'lancer', count: 1,
    icon: 'unit_lancer', desc: 'Charges after a short run, dealing double damage.', tags: ['dps', 'tank'],
  },
  turret: {
    id: 'turret', name: 'Bolt Turret', type: 'building', cost: 3, rarity: 'common', unit: 'turret', count: 1,
    icon: 'bld_turret', desc: 'Defensive ballista. Pulls and shreds ground troops.', tags: ['building'],
  },
  imphut: {
    id: 'imphut', name: 'Imp Hut', type: 'building', cost: 4, rarity: 'rare', unit: 'imphut', count: 1,
    icon: 'bld_imphut', desc: 'Spawns an Imp every 4 seconds.', tags: ['building', 'swarm'],
  },
  fireorb: {
    id: 'fireorb', name: 'Fire Orb', type: 'spell', cost: 4, rarity: 'rare', icon: 'spell_fireball',
    desc: 'A blazing orb that blasts an area and knocks foes back.', tags: ['spell', 'splash'],
    spell: { radius: 2.5, damage: 360, towerMul: 0.35, travel: 'keep', knockback: 1.2, fx: 'fire' },
  },
  arrows: {
    id: 'arrows', name: 'Arrow Volley', type: 'spell', cost: 3, rarity: 'common', icon: 'spell_arrows',
    desc: 'Rains arrows over a wide area. Shreds swarms.', tags: ['spell', 'splash', 'antiair'],
    spell: { radius: 4, damage: 155, towerMul: 0.35, waves: 3, travel: 'keep', fx: 'arrows' },
  },
  spark: {
    id: 'spark', name: 'Spark', type: 'spell', cost: 2, rarity: 'common', icon: 'spell_zap',
    desc: 'Instant zap that stuns everything briefly.', tags: ['spell', 'cheap', 'antiair'],
    spell: { radius: 2.5, damage: 90, towerMul: 0.35, stun: 0.6, travel: 'instant', fx: 'zap' },
  },
  wardrums: {
    id: 'wardrums', name: 'War Drums', type: 'spell', cost: 2, rarity: 'epic', icon: 'spell_rage',
    desc: 'Your troops in the area move and strike 40% faster.', tags: ['spell', 'buff'],
    spell: { radius: 5, rage: { duration: 2, mul: 1.4 }, duration: 6, travel: 'instant', fx: 'rage' },
  },
  frost: {
    id: 'frost', name: 'Frost Nova', type: 'spell', cost: 4, rarity: 'epic', icon: 'spell_freeze',
    desc: 'Freezes everything in the area for 4 seconds.', tags: ['spell', 'antiair'],
    spell: { radius: 3, damage: 60, towerMul: 0.35, freeze: 4, travel: 'instant', fx: 'freeze' },
  },
  mending: {
    id: 'mending', name: 'Mending Light', type: 'spell', cost: 3, rarity: 'rare', icon: 'spell_heal',
    desc: 'Heals your troops and buildings in the area over time.', tags: ['spell', 'buff'],
    spell: { radius: 3.5, heal: 240, duration: 2.5, travel: 'instant', fx: 'heal' },
  },
};

export const CARD_IDS = Object.keys(CARDS);

export const STARTER_DECK = ['knight', 'archers', 'imps', 'brute', 'gunner', 'turret', 'fireorb', 'arrows'];
