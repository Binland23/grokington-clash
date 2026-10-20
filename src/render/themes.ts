export interface ArenaTheme {
  id: string;
  grassA: string;
  grassB: string;
  outside: string;
  outsideDark: string;
  path: string;
  pathEdge: string;
  rim: string;
  water1: string;
  water2: string;
  waterFoam: string;
  bank: string;
  decor: 'trees' | 'pines' | 'rocks' | 'clouds' | 'graves' | 'swamp';
  decorColor: string;
  decorColor2: string;
  /** Lava, toxic slime, etc. glow in the river. */
  glow?: string;
}

export const THEMES: Record<string, ArenaTheme> = {
  meadow: {
    id: 'meadow', grassA: '#86c95a', grassB: '#7cbf51', outside: '#4f8f3a', outsideDark: '#3c7230',
    path: '#dcc58f', pathEdge: '#c4ab74', rim: '#8b8f86', water1: '#4fb7f2', water2: '#2f8fdc', waterFoam: '#c9f0ff',
    bank: '#5e9a3e', decor: 'trees', decorColor: '#3f8a3a', decorColor2: '#2f6e2e',
  },
  swamp: {
    id: 'swamp', grassA: '#7aa452', grassB: '#709a49', outside: '#3e5d33', outsideDark: '#2e4826',
    path: '#b9a36f', pathEdge: '#9c8858', rim: '#6f7466', water1: '#5f9a6a', water2: '#3f7650', waterFoam: '#b8e0a8',
    bank: '#4f7a3a', decor: 'swamp', decorColor: '#4d6b35', decorColor2: '#2f4a25',
  },
  frost: {
    id: 'frost', grassA: '#e4f1f7', grassB: '#d6e8f1', outside: '#a9c6d6', outsideDark: '#8fb0c3',
    path: '#c9d7de', pathEdge: '#aebfca', rim: '#8e9aa6', water1: '#8fd3f2', water2: '#5aaedc', waterFoam: '#ffffff',
    bank: '#b9d3e0', decor: 'pines', decorColor: '#4f7f74', decorColor2: '#3a6359',
  },
  iron: {
    id: 'iron', grassA: '#a9a089', grassB: '#9f977f', outside: '#5d5a52', outsideDark: '#4a4842',
    path: '#c9b98f', pathEdge: '#aa9b72', rim: '#5f5f62', water1: '#6f8fa8', water2: '#4f6f88', waterFoam: '#c8d6e0',
    bank: '#7d7563', decor: 'rocks', decorColor: '#77736a', decorColor2: '#5e5a52',
  },
  ember: {
    id: 'ember', grassA: '#9a6a4a', grassB: '#905f42', outside: '#4a2d24', outsideDark: '#38211b',
    path: '#c9a070', pathEdge: '#a98258', rim: '#4f3b36', water1: '#ff8a2a', water2: '#e2491a', waterFoam: '#ffe08a',
    bank: '#5e3a2c', decor: 'rocks', decorColor: '#3d2a25', decorColor2: '#2b1d19', glow: '#ff7a2a',
  },
  sky: {
    id: 'sky', grassA: '#9ad86a', grassB: '#8fce60', outside: '#bfe6ff', outsideDark: '#a6d8f7',
    path: '#e6d3a0', pathEdge: '#ccb886', rim: '#9aa3a8', water1: '#d8f2ff', water2: '#a9dcff', waterFoam: '#ffffff',
    bank: '#7fbf55', decor: 'clouds', decorColor: '#ffffff', decorColor2: '#e3f3ff',
  },
  necro: {
    id: 'necro', grassA: '#6f6a7d', grassB: '#666174', outside: '#2d2a36', outsideDark: '#221f2a',
    path: '#8f8a7a', pathEdge: '#77725f', rim: '#4a4652', water1: '#5fd08a', water2: '#2f9a5e', waterFoam: '#c8ffd8',
    bank: '#4f4a5a', decor: 'graves', decorColor: '#5a5666', decorColor2: '#3f3c48', glow: '#6fff9a',
  },
};
