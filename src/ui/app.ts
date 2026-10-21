import { setMusicEnabled, setSfxEnabled, sfx } from '../audio/sfx';
import { loadProfile, resetProfile, saveProfile, type Profile } from '../meta/profile';
import { spriteUrl } from '../render/sprites';
import { clear, fmt, h, img } from './dom';

export type ScreenName = 'home' | 'map' | 'cards' | 'gauntlet' | 'battle';
type ScreenFn = (params?: unknown) => HTMLElement;

const screens: Partial<Record<ScreenName, ScreenFn>> = {};
let current: { name: ScreenName; el: HTMLElement; dispose?: () => void } | null = null;

export const app = {
  root: null as unknown as HTMLElement,
  profile: null as unknown as Profile,
};

export function initApp(root: HTMLElement): void {
  app.root = root;
  app.profile = loadProfile();
  applySettings();
}

export function applySettings(): void {
  setSfxEnabled(app.profile.settings.sfx);
  setMusicEnabled(app.profile.settings.music);
}

export function save(): void {
  saveProfile(app.profile);
}

export function registerScreen(name: ScreenName, fn: ScreenFn): void {
  screens[name] = fn;
}

/** Screens can attach a cleanup function to their root element. */
export function onDispose(el: HTMLElement, fn: () => void): void {
  (el as unknown as { __dispose?: () => void }).__dispose = fn;
}

function swapScreen(name: ScreenName, params?: unknown): void {
  const fn = screens[name];
  if (!fn) throw new Error(`no screen ${name}`);
  if (current) {
    const d = (current.el as unknown as { __dispose?: () => void }).__dispose;
    d?.();
  }
  clear(app.root);
  const el = fn(params);
  app.root.appendChild(el);
  current = { name, el };
}

/** Building the 3D arena blocks the main thread, so paint a loading screen first. */
let loaderUp = false;
function goWithLoader(name: ScreenName, params?: unknown): void {
  if (loaderUp) return;
  loaderUp = true;
  const loader = h('div', { class: 'loading loading-battle' },
    h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'GROKINGTON'), h('div', { class: 'l2' }, 'CLASH')),
    h('div', { class: 'spinner' }),
    h('div', { class: 'muted', style: 'font-weight:800' }, 'Preparing the battlefield...'),
  );
  app.root.appendChild(loader);
  // Two frames: the first commits the loader, the second guarantees it was painted before we block.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      swapScreen(name, params);
      app.root.appendChild(loader);
      // The battle's first frame compiles shaders; keep the loader up until it has rendered.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          loader.remove();
          loaderUp = false;
        }),
      );
    }),
  );
}

export function go(name: ScreenName, params?: unknown): void {
  if (!screens[name]) throw new Error(`no screen ${name}`);
  if (name === 'battle') goWithLoader(name, params);
  else swapScreen(name, params);
}

export function currentScreen(): ScreenName | null {
  return current?.name ?? null;
}

// ---------------------------------------------------------------- modals & toasts

export function modal(content: Node, opts: { closable?: boolean; onClose?: () => void; cls?: string } = {}): { close: () => void; el: HTMLElement } {
  const closable = opts.closable ?? true;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    opts.onClose?.();
  };
  const box = h(
    'div',
    { class: `modal panel ${opts.cls ?? ''}` },
    closable
      ? h('button', {
          class: 'close',
          onclick: () => {
            sfx('click');
            close();
          },
        }, '✕')
      : null,
    content,
  );
  const back = h('div', {
    class: 'modal-back',
    onclick: (e: Event) => {
      if (closable && e.target === back) close();
    },
  }, box);
  app.root.appendChild(back);
  return { close, el: box };
}

export function confirmModal(title: string, text: string, okLabel: string, onOk: () => void, danger = false): void {
  const m = modal(
    h('div', null,
      h('h2', { class: 'stroke' }, title),
      h('p', { class: 'center', style: 'font-weight:700' }, text),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
        h('button', { class: 'btn btn-gray', onclick: () => { sfx('click'); m.close(); } }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-red' : 'btn-green'}`, onclick: () => { sfx('click'); m.close(); onOk(); } }, okLabel),
      ),
    ),
  );
}

export function toast(msg: string, ms = 1600): void {
  const t = h('div', { class: 'b-toast', style: 'bottom:auto;top:calc(var(--safe-top) + 70px)' }, msg);
  app.root.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------- chrome

export function goldPill(): HTMLElement {
  return h('div', { class: 'currency', id: 'gold-pill' }, img(spriteUrl('ui_gold')), fmt(app.profile.gold));
}

export function topbar(extra?: Node): HTMLElement {
  const p = app.profile;
  return h('div', { class: 'topbar' },
    img(spriteUrl('portrait_hero'), 'avatar'),
    h('div', { class: 'player-meta' },
      h('div', { class: 'name stroke' }, p.name),
      h('div', { class: 'sub' }, `${Object.keys(p.cards).length}/22 cards · ${p.stats.wins} wins`),
    ),
    extra ?? null,
    goldPill(),
    h('button', { class: 'icon-btn', onclick: () => { sfx('click'); openSettings(); }, 'aria-label': 'Settings' }, '⚙️'),
  );
}

export function navbar(active: ScreenName): HTMLElement {
  const item = (name: ScreenName, ico: string, label: string) =>
    h('button', {
      class: active === name ? 'active' : '',
      onclick: () => {
        if (active === name) return;
        sfx('click');
        go(name);
      },
    }, h('span', { class: 'ico' }, ico), label);
  return h('div', { class: 'navbar' },
    item('cards', '🃏', 'Cards'),
    item('home', '⚔️', 'Battle'),
    item('map', '🗺️', 'Campaign'),
    item('gauntlet', '🔥', 'Gauntlet'),
  );
}

export function openSettings(): void {
  const s = app.profile.settings;
  const row = (label: string, key: keyof typeof s) => {
    const sw = h('button', { class: `switch ${s[key] ? 'on' : ''}` });
    sw.onclick = () => {
      s[key] = !s[key];
      sw.classList.toggle('on', s[key]);
      applySettings();
      save();
      sfx('click');
    };
    return h('div', { class: 'toggle' }, label, sw);
  };
  const m = modal(
    h('div', null,
      h('h2', { class: 'stroke' }, 'Settings'),
      row('Sound effects', 'sfx'),
      row('Music', 'music'),
      row('Vibration', 'vibrate'),
      h('div', { class: 'toggle' }, 'Player name',
        h('button', {
          class: 'btn btn-blue btn-sm',
          onclick: () => {
            const n = prompt('Your name, Banner Lord?', app.profile.name);
            if (n && n.trim()) {
              app.profile.name = n.trim().slice(0, 16);
              save();
              m.close();
              go('home');
            }
          },
        }, 'Rename'),
      ),
      h('div', { style: 'margin-top:16px;display:flex;justify-content:center' },
        h('button', {
          class: 'btn btn-red btn-sm',
          onclick: () =>
            confirmModal('Reset progress?', 'This erases all cards, gold and campaign progress.', 'Reset', () => {
              app.profile = resetProfile();
              save();
              m.close();
              go('home');
            }, true),
        }, 'Reset progress'),
      ),
      h('p', { class: 'center muted', style: 'font-size:12px;margin-top:14px' },
        'Grokington Clash · art generated with Grok · v0.1'),
    ),
  );
}
