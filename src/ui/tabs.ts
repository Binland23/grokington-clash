/**
 * Swipeable, animated paging between the main-menu pages (Cards, Battle, Campaign, Gauntlet).
 * Only each page's `.content` slides; the top bar and nav bar stay put, like Clash Royale.
 * app.ts owns the screen registry and hands this module the bits it needs.
 */
import type { ScreenName } from './app';

/** Left-to-right order of the main-menu pages; matches the navbar buttons. */
export const TABS: ScreenName[] = ['cards', 'home', 'map', 'gauntlet'];
const SLIDE_MS = 340;
const SLIDE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface TabHost {
  root: HTMLElement;
  current: () => { name: ScreenName; el: HTMLElement } | null;
  build: (name: ScreenName) => HTMLElement | null;
  /** Make `to` the current screen after `from` has been torn down. */
  land: (name: ScreenName, el: HTMLElement) => void;
  dispose: (el: HTMLElement) => void;
}

interface Slide {
  from: HTMLElement;
  to: HTMLElement;
  fromC: HTMLElement;
  toC: HTMLElement;
  target: ScreenName;
  /** +1: the target page comes in from the right. */
  dir: 1 | -1;
  width: number;
  timer: number;
}

export const isTab = (n: ScreenName | undefined): n is ScreenName => !!n && TABS.includes(n);
const contentOf = (el: HTMLElement) => el.querySelector(':scope > .content') as HTMLElement;

function setX(c: HTMLElement, x: number, animate: boolean): void {
  c.style.transition = animate ? `transform ${SLIDE_MS}ms ${SLIDE_EASE}` : 'none';
  c.style.transform = `translate3d(${x}px,0,0)`;
}

function clearX(c: HTMLElement): void {
  c.style.transform = '';
  c.style.transition = '';
}

export function createTabs(host: TabHost) {
  let slide: Slide | null = null;

  const begin = (target: ScreenName): Slide | null => {
    const cur = host.current();
    if (!cur || !isTab(cur.name)) return null;
    const to = host.build(target);
    if (!to) return null;
    to.classList.add('tab-incoming');
    host.root.appendChild(to);
    const dir: 1 | -1 = TABS.indexOf(target) > TABS.indexOf(cur.name) ? 1 : -1;
    const sl: Slide = { from: cur.el, to, fromC: contentOf(cur.el), toC: contentOf(to), target, dir, width: host.root.clientWidth, timer: 0 };
    host.root.classList.add('sliding');
    place(sl, 0, false);
    slide = sl;
    return sl;
  };

  /** `dx` is the finger offset of the outgoing page; the incoming page trails it by one screen width. */
  const place = (sl: Slide, dx: number, animate: boolean) => {
    setX(sl.fromC, dx, animate);
    setX(sl.toC, dx + sl.dir * sl.width, animate);
  };

  const finish = (sl: Slide) => {
    clearTimeout(sl.timer);
    host.dispose(sl.from);
    sl.from.remove();
    sl.to.classList.remove('tab-incoming');
    clearX(sl.toC);
    host.land(sl.target, sl.to);
    host.root.classList.remove('sliding');
    slide = null;
  };

  const abort = (sl: Slide) => {
    clearTimeout(sl.timer);
    host.dispose(sl.to);
    sl.to.remove();
    clearX(sl.fromC);
    host.root.classList.remove('sliding');
    slide = null;
  };

  const commit = (sl: Slide, animate = true) => {
    // Move the navbar highlight now so it eases across while the pages slide.
    const idx = TABS.indexOf(sl.target);
    sl.from.querySelectorAll('.navbar button').forEach((b, i) => b.classList.toggle('active', i === idx));
    if (!animate) return finish(sl);
    place(sl, -sl.dir * sl.width, true);
    sl.timer = window.setTimeout(() => finish(sl), SLIDE_MS + 30);
  };

  const revert = (sl: Slide) => {
    place(sl, 0, true);
    sl.timer = window.setTimeout(() => abort(sl), SLIDE_MS + 30);
  };

  const horizontallyScrollable = (el: Element | null): boolean => {
    for (let n = el; n && n !== host.root; n = n.parentElement) {
      const st = getComputedStyle(n);
      if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  };

  const initSwipe = () => {
    const root = host.root;
    let g: { id: number; x0: number; y0: number; active: boolean; dx: number; lastX: number; lastT: number; v: number } | null = null;
    let sl: Slide | null = null;
    let edge: HTMLElement | null = null;

    const onMove = (e: PointerEvent) => {
      const cur = host.current();
      if (!g || e.pointerId !== g.id || !cur) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (!g.active) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx) * 0.8) {
          g = null; // a vertical scroll, not a page swipe
          window.removeEventListener('pointermove', onMove);
          return;
        }
        g.active = true;
        try {
          root.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
      const now = performance.now();
      const dt = Math.max(1, now - g.lastT);
      g.v = g.v * 0.6 + ((e.clientX - g.lastX) / dt) * 0.4;
      g.lastX = e.clientX;
      g.lastT = now;
      g.dx = dx;
      const j = TABS.indexOf(cur.name) + (dx < 0 ? 1 : -1);
      if (sl && sl.target !== TABS[j]) {
        abort(sl);
        sl = null;
      }
      if (!sl && j >= 0 && j < TABS.length) {
        if (edge) {
          clearX(edge);
          edge = null;
        }
        sl = begin(TABS[j]);
      }
      if (sl) place(sl, Math.max(-sl.width, Math.min(sl.width, dx)), false);
      else {
        // First/last page: rubber-band.
        edge = contentOf(cur.el);
        setX(edge, dx * 0.28, false);
      }
    };

    const onEnd = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const st = g;
      g = null;
      window.removeEventListener('pointermove', onMove);
      if (!st.active) return;
      // Swallow the click the browser would otherwise fire at the end of a swipe.
      const swallow = (ev: Event) => ev.stopPropagation();
      root.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => root.removeEventListener('click', swallow, true), 80);
      if (sl) {
        const toward = -sl.dir; // sign of dx that brings the target page in
        const far = Math.abs(st.dx) > sl.width * 0.28 && Math.sign(st.dx) === toward;
        const flick = Math.abs(st.v) > 0.45 && Math.sign(st.v) === toward;
        const s2 = sl;
        sl = null;
        if (e.type !== 'pointercancel' && (far || flick)) commit(s2);
        else revert(s2);
      } else if (edge) {
        const c = edge;
        edge = null;
        setX(c, 0, true);
        setTimeout(() => clearX(c), SLIDE_MS);
      }
    };

    root.addEventListener('pointerdown', (e) => {
      const cur = host.current();
      if (g || slide || !cur || !isTab(cur.name)) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (root.querySelector('.modal-back') || horizontallyScrollable(e.target as Element)) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, dx: 0, lastX: e.clientX, lastT: performance.now(), v: 0 };
      sl = null;
      edge = null;
      window.addEventListener('pointermove', onMove);
    });
    root.addEventListener('pointerup', onEnd);
    root.addEventListener('pointercancel', onEnd);
  };

  return {
    initSwipe,
    /** Animated hop to another main page (navbar tap, mode buttons). Falls back to false if it can't slide. */
    slideTo(target: ScreenName): boolean {
      const sl = begin(target);
      if (!sl) return false;
      void sl.toC.offsetWidth; // lay the incoming page out at its start position first
      requestAnimationFrame(() => commit(sl));
      return true;
    },
    /** Land any animation in flight immediately. */
    settle(): void {
      if (slide) commit(slide, false);
    },
  };
}
