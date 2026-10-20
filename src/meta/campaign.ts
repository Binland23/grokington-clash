import type { AIProfile } from '../engine/ai';
import { AI_PROFILES } from '../engine/ai';
import type { ChestType } from './profile';
import type { BattleMods } from '../engine/types';

export interface Region {
  id: string;
  name: string;
  warlord: string;
  title: string;
  portrait: string;
  theme: string;
  color: string;
  power: string;
  taunt: string;
  defeat: string;
}

export interface Stage {
  index: number;
  region: number;
  name: string;
  boss: boolean;
  deck: string[];
  level: number;
  ai: AIProfile;
  aiName: 'easy' | 'normal' | 'hard' | 'brutal';
  power: string | null;
  towerHpMul: number;
  enemyMods: Partial<BattleMods>;
  reward: { gold: number; chest: ChestType; card?: string; power?: string };
  /** Map position, % of map width / height. */
  pos: { x: number; y: number };
}

export const REGIONS: Region[] = [
  {
    id: 'bogfen', name: 'Bogfen Marsh', warlord: 'Grubnok', title: 'the Goblin King', portrait: 'portrait_goblin',
    theme: 'swamp', color: '#6bcf4f', power: 'imphorde',
    taunt: 'Har! Another little lord come to lose his crown? My imps are hungry!',
    defeat: 'Nooo! My gold! My beautiful swamp! Fine... take my imps, see if I care!',
  },
  {
    id: 'frostpeak', name: 'Frostpeak Heights', warlord: 'Ysolde', title: 'the Frost Witch', portrait: 'portrait_frost',
    theme: 'frost', color: '#8fdcff', power: 'frostbreath',
    taunt: 'How warm you look. Let us fix that, shall we?',
    defeat: 'The ice... cracks. Very well. My breath is yours, little flame.',
  },
  {
    id: 'ironworks', name: 'The Ironworks', warlord: 'The Iron Baron', title: 'Lord of the Forge', portrait: 'portrait_iron',
    theme: 'iron', color: '#c0c4cc', power: 'bulwark',
    taunt: 'Steel does not bend, child. And neither do I.',
    defeat: 'Impossible! My calculations were flawless! ...Take the Sentinel. It is yours.',
  },
  {
    id: 'emberwaste', name: 'Emberwaste', warlord: 'Pyra', title: 'the Ember Queen', portrait: 'portrait_ember',
    theme: 'ember', color: '#ff7a3d', power: 'meteor',
    taunt: 'Everything burns eventually. You will simply burn first.',
    defeat: 'You... endure the flame. Then carry it. The sky-fire answers to you now.',
  },
  {
    id: 'skyhold', name: 'Skyhold Isles', warlord: 'Captain Squall', title: 'Terror of the Clouds', portrait: 'portrait_sky',
    theme: 'sky', color: '#9ad8ff', power: 'thunder',
    taunt: 'Ahoy, groundling! Hope ye packed an umbrella — there be storms today!',
    defeat: 'Blow me down! Ye fight like a hurricane. Take me storm, ye earned it!',
  },
  {
    id: 'necropolis', name: 'The Hollow Necropolis', warlord: 'The Hollow King', title: 'Last of the Warlords', portrait: 'portrait_hollow',
    theme: 'necro', color: '#7dff9b', power: 'raisedead',
    taunt: 'Six crowns you have taken. Mine was buried long ago. Come, join my court.',
    defeat: 'At last... rest. Grokington is yours, Banner Lord. Rule it well.',
  },
];

const STAGE_NAMES = [
  ['Muddy Crossing', 'Goblin Toll Bridge', 'Stinkroot Hollow', 'Grubnok\'s Throne'],
  ['Snowdrift Pass', 'Frozen Falls', 'Crystal Caverns', 'Palace of Ice'],
  ['Slag Fields', 'Gearwork Gate', 'The Great Furnace', 'Baron\'s Citadel'],
  ['Ashen Road', 'Cinder Canyon', 'Magma Rift', 'Throne of Embers'],
  ['Cloud Docks', 'Windward Isle', 'The Storm Wall', 'The Flying Fortress'],
  ['Gravegate', 'Bone Gardens', 'Wailing Crypt', 'The Hollow Throne'],
];

const DECKS: string[][] = [
  ['imps', 'knight', 'archers', 'arrows', 'spark', 'turret', 'gunner', 'boneswarm'],
  ['imps', 'boneswarm', 'archers', 'spark', 'knight', 'imphut', 'arrows', 'brute'],
  ['imps', 'imphut', 'gargoyles', 'spark', 'knight', 'archers', 'fireorb', 'boneswarm'],
  ['imps', 'imphut', 'gargoyles', 'boneswarm', 'spark', 'boarrider', 'archers', 'fireorb'],
  ['knight', 'archers', 'frost', 'berserker', 'gunner', 'arrows', 'turret', 'wyrmling'],
  ['berserker', 'wyrmling', 'frost', 'archers', 'brute', 'spark', 'gunner', 'mending'],
  ['wyrmling', 'frost', 'pyromancer', 'knight', 'gargoyles', 'arrows', 'berserker', 'turret'],
  ['frost', 'wyrmling', 'berserker', 'pyromancer', 'brute', 'arrows', 'gargoyles', 'mending'],
  ['ironclad', 'turret', 'knight', 'gunner', 'brute', 'arrows', 'spark', 'archers'],
  ['ironclad', 'boarrider', 'turret', 'gunner', 'knight', 'fireorb', 'imps', 'berserker'],
  ['brute', 'ironclad', 'gunner', 'turret', 'lancer', 'arrows', 'spark', 'archers'],
  ['lancer', 'ironclad', 'brute', 'turret', 'gunner', 'fireorb', 'spark', 'imphut'],
  ['pyromancer', 'wyrmling', 'fireorb', 'knight', 'imps', 'archers', 'turret', 'brute'],
  ['pyromancer', 'wardrums', 'boneswarm', 'wyrmling', 'fireorb', 'berserker', 'gargoyles', 'arrows'],
  ['pyromancer', 'wyrmling', 'blimp', 'fireorb', 'knight', 'wardrums', 'spark', 'gunner'],
  ['pyromancer', 'wyrmling', 'fireorb', 'blimp', 'wardrums', 'lancer', 'imps', 'frost'],
  ['blimp', 'gargoyles', 'wyrmling', 'archers', 'spark', 'knight', 'arrows', 'gunner'],
  ['blimp', 'gargoyles', 'boarrider', 'wardrums', 'imps', 'arrows', 'turret', 'gunner'],
  ['blimp', 'wyrmling', 'gargoyles', 'lancer', 'fireorb', 'spark', 'mending', 'archers'],
  ['blimp', 'gargoyles', 'wyrmling', 'boarrider', 'wardrums', 'pyromancer', 'spark', 'frost'],
  ['boneswarm', 'imphut', 'berserker', 'spark', 'knight', 'pyromancer', 'arrows', 'gargoyles'],
  ['boneswarm', 'brute', 'gargoyles', 'wyrmling', 'mending', 'fireorb', 'imps', 'ironclad'],
  ['boneswarm', 'blimp', 'imphut', 'frost', 'lancer', 'pyromancer', 'arrows', 'wardrums'],
  ['boneswarm', 'brute', 'pyromancer', 'ironclad', 'frost', 'wyrmling', 'imphut', 'fireorb'],
];

const LEVELS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6];
const AIS: Stage['aiName'][] = [
  'easy', 'easy', 'easy', 'easy',
  'easy', 'normal', 'normal', 'normal',
  'normal', 'normal', 'normal', 'normal',
  'normal', 'normal', 'normal', 'hard',
  'normal', 'hard', 'hard', 'hard',
  'hard', 'hard', 'hard', 'hard',
];
/** First-clear card unlocks, by stage index. */
const UNLOCKS: Record<number, string> = {
  0: 'spark', 1: 'boneswarm', 2: 'imphut', 3: 'gargoyles',
  4: 'berserker', 5: 'wyrmling', 6: 'mending', 7: 'frost',
  8: 'ironclad', 9: 'boarrider', 11: 'lancer',
  12: 'pyromancer', 13: 'wardrums', 15: 'blimp',
};
/** Winding road positions on the world map, bottom (start) to top. */
const POSITIONS = [
  { x: 30, y: 92 }, { x: 62, y: 88 }, { x: 40, y: 82 }, { x: 70, y: 77 },
  { x: 38, y: 72 }, { x: 66, y: 67 }, { x: 34, y: 62 }, { x: 64, y: 57 },
  { x: 36, y: 52 }, { x: 68, y: 47.5 }, { x: 38, y: 43 }, { x: 66, y: 38 },
  { x: 34, y: 33.5 }, { x: 64, y: 29.5 }, { x: 36, y: 25.5 }, { x: 66, y: 21.5 },
  { x: 38, y: 17.5 }, { x: 64, y: 14 }, { x: 36, y: 10.5 }, { x: 62, y: 7.5 },
  { x: 40, y: 5.5 }, { x: 60, y: 4 }, { x: 42, y: 2.6 }, { x: 52, y: 1.4 },
];

export const STAGES: Stage[] = DECKS.map((deck, index) => {
  const region = Math.floor(index / 4);
  const boss = index % 4 === 3;
  const aiName = AIS[index];
  const chest: ChestType = boss ? (region >= 3 ? 'royal' : 'gold') : index % 4 === 2 ? 'silver' : 'wood';
  return {
    index,
    region,
    name: STAGE_NAMES[region][index % 4],
    boss,
    deck,
    level: LEVELS[index],
    ai: {
      ...AI_PROFILES[aiName],
      // Campaign veterans leave room for human input; brutal reactions belong in long Gauntlet runs.
      ...(aiName === 'hard' ? { think: [1.2, 1.9] as [number, number], skill: 0.65, reaction: 1.2 } : {}),
      openingDelay: index === 0 ? 12 : index < 4 ? 8 : 4,
    },
    aiName,
    power: boss ? REGIONS[region].power : region >= 2 && index % 4 === 2 ? 'rally' : null,
    towerHpMul: index === 0 ? 0.8 : boss && region > 0 ? 1.1 : 1,
    enemyMods: {
      startMana: index === 0 ? 2 : index < 4 ? 3 : 5,
      manaRate: index === 0 ? 0.65 : index === 1 || index === 3 ? 0.75
        : index === 15 ? 0.8 : index === 2 || index === 11 || index === 23 ? 0.85
        : region < 3 ? 0.9 : 0.95,
    },
    reward: {
      gold: 60 + index * 25 + (boss ? 150 : 0),
      chest,
      card: UNLOCKS[index],
      power: boss ? REGIONS[region].power : undefined,
    },
    pos: POSITIONS[index],
  };
});

export function stageOpponentName(s: Stage): string {
  const r = REGIONS[s.region];
  if (s.boss) return `${r.warlord}`;
  const titles = [
    ['Swamp Scout', 'Bog Raider', 'Mire Captain'],
    ['Snow Sentry', 'Frost Acolyte', 'Ice Knight'],
    ['Foundry Hand', 'Gear Sergeant', 'Forge Captain'],
    ['Ash Cultist', 'Cinder Mage', 'Flame Warden'],
    ['Deck Swabber', 'Cloud Corsair', 'Storm Mate'],
    ['Grave Digger', 'Bone Priest', 'Crypt Lord'],
  ];
  return titles[s.region][s.index % 4];
}
