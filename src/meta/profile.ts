import { CARDS, MAX_LEVEL, STARTER_DECK } from '../engine/cards';
import type { BattleMods, Rarity } from '../engine/types';

export type ChestType = 'wood' | 'silver' | 'gold' | 'royal';

export interface CardProgress {
  level: number;
  copies: number;
}

export interface GauntletRun {
  wins: number;
  boons: string[];
  deck: string[];
  power: string;
  offer: string[] | null;
}

export interface Profile {
  version: 1;
  name: string;
  gold: number;
  cards: Record<string, CardProgress>;
  deck: string[];
  power: string;
  powers: string[];
  cleared: Record<number, number>;
  chests: ChestType[];
  gauntlet: { best: number; run: GauntletRun | null };
  stats: { wins: number; losses: number; draws: number; crowns: number; threeCrowns: number };
  settings: { sfx: boolean; music: boolean; vibrate: boolean };
  seenTutorial: boolean;
}

const KEY = 'grokington-clash-save-v1';
export const CHEST_SLOTS = 4;

/** Copies needed to go from level L to L+1 (index = L-1). */
export const COPIES_NEEDED = [2, 3, 5, 8, 12, 18, 25, 35, 50];
export const GOLD_NEEDED = [20, 50, 100, 200, 350, 600, 900, 1300, 1800];
export const RARITY_MUL: Record<Rarity, number> = { common: 1, rare: 1.5, epic: 2.5 };

export function newProfile(): Profile {
  const cards: Record<string, CardProgress> = {};
  for (const id of STARTER_DECK) cards[id] = { level: 1, copies: 0 };
  return {
    version: 1,
    name: 'Banner Lord',
    gold: 100,
    cards,
    deck: STARTER_DECK.slice(),
    power: 'rally',
    powers: ['rally'],
    cleared: {},
    chests: ['wood'],
    gauntlet: { best: 0, run: null },
    stats: { wins: 0, losses: 0, draws: 0, crowns: 0, threeCrowns: 0 },
    settings: { sfx: true, music: true, vibrate: true },
    seenTutorial: false,
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      const base = newProfile();
      return { ...base, ...p, settings: { ...base.settings, ...p.settings }, stats: { ...base.stats, ...p.stats } };
    }
  } catch {
    /* corrupted or unavailable storage: start fresh */
  }
  return newProfile();
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked */
  }
}

export function resetProfile(): Profile {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return newProfile();
}

export function levelsOf(p: Profile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, c] of Object.entries(p.cards)) out[id] = c.level;
  return out;
}

/** Tower / commander level: average level of the current deck. */
export function kingLevel(p: Profile): number {
  const lv = p.deck.map((id) => p.cards[id]?.level ?? 1);
  return Math.max(1, Math.round(lv.reduce((a, b) => a + b, 0) / lv.length));
}

export function upgradeCost(p: Profile, id: string): { copies: number; gold: number } | null {
  const c = p.cards[id];
  if (!c || c.level >= MAX_LEVEL) return null;
  const mul = RARITY_MUL[CARDS[id].rarity];
  return { copies: COPIES_NEEDED[c.level - 1], gold: Math.round(GOLD_NEEDED[c.level - 1] * mul) };
}

export function canUpgrade(p: Profile, id: string): boolean {
  const cost = upgradeCost(p, id);
  const c = p.cards[id];
  return !!cost && !!c && c.copies >= cost.copies && p.gold >= cost.gold;
}

export function upgrade(p: Profile, id: string): boolean {
  if (!canUpgrade(p, id)) return false;
  const cost = upgradeCost(p, id)!;
  const c = p.cards[id];
  c.copies -= cost.copies;
  p.gold -= cost.gold;
  c.level++;
  return true;
}

export function unlockCard(p: Profile, id: string): boolean {
  if (p.cards[id]) return false;
  p.cards[id] = { level: Math.max(1, kingLevel(p) - 1), copies: 0 };
  return true;
}

export function addChest(p: Profile, type: ChestType): boolean {
  if (p.chests.length >= CHEST_SLOTS) {
    p.gold += CHEST_INFO[type].gold[0];
    return false;
  }
  p.chests.push(type);
  return true;
}

export const CHEST_INFO: Record<ChestType, { name: string; sprite: string; cards: number; gold: [number, number]; stacks: number }> = {
  wood: { name: 'Wooden Chest', sprite: 'chest_wood', cards: 8, gold: [30, 60], stacks: 2 },
  silver: { name: 'Silver Chest', sprite: 'chest_silver', cards: 18, gold: [80, 140], stacks: 3 },
  gold: { name: 'Golden Chest', sprite: 'chest_gold', cards: 40, gold: [220, 360], stacks: 4 },
  royal: { name: 'Royal Chest', sprite: 'chest_royal', cards: 90, gold: [600, 900], stacks: 5 },
};

export interface ChestLoot {
  gold: number;
  cards: { id: string; count: number }[];
}

/** Roll a chest's contents from the cards the player owns (weighted toward commons). */
export function rollChest(p: Profile, type: ChestType, rnd = Math.random): ChestLoot {
  const info = CHEST_INFO[type];
  const owned = Object.keys(p.cards);
  const weight = (id: string) => ({ common: 3, rare: 2, epic: 1 })[CARDS[id].rarity];
  const pickOne = (exclude: Set<string>) => {
    const pool = owned.filter((id) => !exclude.has(id));
    const total = pool.reduce((s, id) => s + weight(id), 0);
    let r = rnd() * total;
    for (const id of pool) {
      r -= weight(id);
      if (r <= 0) return id;
    }
    return pool[pool.length - 1];
  };
  const stacks = Math.min(info.stacks, owned.length);
  const chosen = new Set<string>();
  const ids: string[] = [];
  for (let i = 0; i < stacks; i++) {
    const id = pickOne(chosen);
    chosen.add(id);
    ids.push(id);
  }
  // Split the card count, scaled down for rarer cards.
  let remaining = info.cards;
  const cards = ids.map((id, i) => {
    const share = i === ids.length - 1 ? remaining : Math.max(1, Math.round((info.cards / ids.length) * (0.6 + rnd() * 0.8)));
    remaining = Math.max(0, remaining - share);
    const count = Math.max(1, Math.round(share / RARITY_MUL[CARDS[id].rarity]));
    return { id, count };
  });
  const gold = Math.round(info.gold[0] + rnd() * (info.gold[1] - info.gold[0]));
  return { gold, cards };
}

export function applyLoot(p: Profile, loot: ChestLoot): void {
  p.gold += loot.gold;
  for (const c of loot.cards) {
    if (!p.cards[c.id]) p.cards[c.id] = { level: 1, copies: 0 };
    p.cards[c.id].copies += c.count;
  }
}

// ---------------------------------------------------------------- gauntlet boons

export interface Boon {
  id: string;
  name: string;
  desc: string;
  icon: string;
  apply: (m: BattleMods) => void;
}

export const BOONS: Boon[] = [
  { id: 'hide', name: 'Iron Hide', icon: '🛡️', desc: '+12% troop and building health.', apply: (m) => (m.hpMul *= 1.12) },
  { id: 'steel', name: 'Sharpened Steel', icon: '⚔️', desc: '+12% troop damage.', apply: (m) => (m.dmgMul *= 1.12) },
  { id: 'spring', name: 'Mana Spring', icon: '💧', desc: '+12% mana regeneration.', apply: (m) => (m.manaRate *= 1.12) },
  { id: 'start', name: 'Head Start', icon: '⏩', desc: 'Start each battle with +2 mana.', apply: (m) => (m.startMana = Math.min(10, m.startMana + 2)) },
  { id: 'walls', name: 'Stone Walls', icon: '🏰', desc: '+20% tower health.', apply: (m) => (m.towerHpMul *= 1.2) },
  { id: 'cry', name: 'Battle Cry', icon: '📯', desc: 'Commander power charges 30% faster.', apply: (m) => (m.powerRate *= 1.3) },
  { id: 'arcane', name: 'Arcane Focus', icon: '🔮', desc: '+20% spell damage.', apply: (m) => (m.spellMul *= 1.2) },
];

export function boonMods(ids: string[]): Partial<BattleMods> {
  const m: BattleMods = { hpMul: 1, dmgMul: 1, manaRate: 1, startMana: 5, towerHpMul: 1, powerRate: 1, spellMul: 1 };
  for (const id of ids) BOONS.find((b) => b.id === id)?.apply(m);
  return m;
}
