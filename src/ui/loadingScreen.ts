import { h } from './dom';

const ART = `${import.meta.env.BASE_URL}assets/sprites/bg_loading.webp`;

const TIPS = [
  'Put a tanky troop in front of your ranged units.',
  'Spells wreck swarms: save the Fireball for a crowd.',
  'Mana refills faster in the last minute. Spend it!',
  'Drag a card onto the field, then lift your finger to deploy.',
  'Towers fall faster when you push both lanes.',
  'Your Commander Power charges as you fight. Time it well.',
  'Upgrade cards from the Cards tab with gold and copies.',
];

export interface LoadingScreen {
  el: HTMLElement;
  /** 0..1. Only ever moves forward. */
  setProgress: (f: number) => void;
  setStatus: (text: string) => void;
  /** Swap the status line for a pulsing "Tap to play". */
  showTap: () => void;
  /** Creep the bar toward ~90% on its own (for work whose length we can't measure). */
  creep: () => void;
  destroy: () => void;
}

/** Key-art loading screen: slow-pan painting, rising embers, bouncing logo, shiny progress bar, rotating tips. */
export function loadingScreen(extraClass = ''): LoadingScreen {
  const art = h('div', { class: 'ls-art' });
  const img = new Image();
  img.onload = () => {
    art.style.backgroundImage = `url(${ART})`;
    art.classList.add('in');
  };
  img.src = ART;

  const embers = h('div', { class: 'ls-embers' },
    ...Array.from({ length: 22 }, (_, i) => {
      const s = h('i');
      s.style.left = `${(i * 47 + Math.random() * 30) % 100}%`;
      s.style.animationDuration = `${5 + Math.random() * 6}s`;
      s.style.animationDelay = `${-Math.random() * 9}s`;
      const size = 2 + Math.random() * 4;
      s.style.width = s.style.height = `${size}px`;
      return s;
    }),
  );

  const fill = h('i');
  const pct = h('span', { class: 'ls-pct' }, '0%');
  const bar = h('div', { class: 'ls-bar' }, fill, pct);
  const status = h('div', { class: 'ls-status' }, 'Summoning warriors...');
  const tip = h('div', { class: 'ls-tip' }, TIPS[Math.floor(Math.random() * TIPS.length)]);

  const el = h('div', { class: `loading loading-art ${extraClass}`.trim() },
    art,
    h('div', { class: 'ls-shade' }),
    embers,
    h('div', { class: 'logo ls-logo' }, h('div', { class: 'l1' }, 'GROKINGTON'), h('div', { class: 'l2' }, 'CLASH')),
    h('div', { class: 'ls-bottom' }, tip, bar, status),
  );

  let shown = 0;
  let creepTimer = 0;
  const setProgress = (f: number) => {
    shown = Math.max(shown, Math.min(1, f));
    const v = Math.round(shown * 100);
    fill.style.width = `${v}%`;
    pct.textContent = `${v}%`;
  };
  let tipI = Math.floor(Math.random() * TIPS.length);
  const tipTimer = window.setInterval(() => {
    tip.classList.add('out');
    setTimeout(() => {
      tipI = (tipI + 1) % TIPS.length;
      tip.textContent = TIPS[tipI];
      tip.classList.remove('out');
    }, 350);
  }, 3200);

  return {
    el,
    setProgress,
    setStatus: (t) => (status.textContent = t),
    showTap: () => {
      status.textContent = 'Tap to play';
      status.classList.add('tap');
      el.classList.add('ready');
    },
    creep: () => {
      creepTimer = window.setInterval(() => setProgress(shown + (0.92 - shown) * 0.12), 90);
    },
    destroy: () => {
      clearInterval(tipTimer);
      clearInterval(creepTimer);
      el.remove();
    },
  };
}
