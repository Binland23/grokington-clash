export interface PowerDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** Seconds to charge from empty at normal rate. */
  chargeTime: number;
  /** none = instant; own = must target your half; any = anywhere. */
  targeting: 'none' | 'own' | 'any';
  radius?: number;
  color: string;
}

export const POWERS: Record<string, PowerDef> = {
  rally: {
    id: 'rally', name: 'Rally Horn', icon: '📯', chargeTime: 32, targeting: 'none', color: '#ff7a3d',
    desc: 'Every one of your troops on the field fights and moves 40% faster for 6 seconds.',
  },
  imphorde: {
    id: 'imphorde', name: 'Imp Horde', icon: '👺', chargeTime: 30, targeting: 'own', radius: 1.2, color: '#6bcf4f',
    desc: 'Grubnok\'s trick: summon a gang of 5 imps anywhere on your side.',
  },
  frostbreath: {
    id: 'frostbreath', name: 'Frost Breath', icon: '❄️', chargeTime: 38, targeting: 'any', radius: 3.2, color: '#8fdcff',
    desc: 'Ysolde\'s breath freezes everything in a wide area for 3.5 seconds.',
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', icon: '🛡️', chargeTime: 40, targeting: 'own', radius: 1, color: '#c0c4cc',
    desc: 'The Iron Baron\'s Stone Sentinel: a tough guardian that draws fire for 20 seconds.',
  },
  meteor: {
    id: 'meteor', name: 'Meteor', icon: '☄️', chargeTime: 45, targeting: 'any', radius: 2.6, color: '#ff5a2a',
    desc: 'Pyra calls down a meteor. After a short delay it devastates an area.',
  },
  thunder: {
    id: 'thunder', name: 'Thunderstrike', icon: '⚡', chargeTime: 40, targeting: 'none', color: '#ffe14a',
    desc: 'Captain Squall\'s storm strikes the three toughest enemy troops or buildings.',
  },
  raisedead: {
    id: 'raisedead', name: 'Raise Dead', icon: '💀', chargeTime: 32, targeting: 'own', radius: 1.4, color: '#7dff9b',
    desc: 'The Hollow King raises 7 skeletons from the ground anywhere on your side.',
  },
};

export const POWER_IDS = Object.keys(POWERS);
