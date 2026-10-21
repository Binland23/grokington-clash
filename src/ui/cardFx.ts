import { sfx } from '../audio/sfx';
import { CARDS } from '../engine/cards';
import { app } from './app';
import { h } from './dom';
import { cardStats, cardView } from './widgets';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function rectIn(el: Element, root: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  return new DOMRect(r.left - o.left, r.top - o.top, r.width, r.height);
}

/**
 * Inspect transition: a copy of the tapped card lifts out of its slot, flips and flies into
 * the detail view's card, which is hidden until the copy lands.
 */
export function flyCard(id: string, from: Element | null | undefined, to: HTMLElement, level?: number): void {
  if (!from || reduced()) return;
  const root = app.root;
  const a = rectIn(from, root);
  const b = rectIn(to, root);
  if (!a.width || !b.width) return;
  const ghost = h('div', { class: 'fly-card', style: `left:${b.x}px;top:${b.y}px;width:${b.width}px` }, cardView(id, { level }));
  root.appendChild(ghost);
  to.style.visibility = 'hidden';
  const s = a.width / b.width;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  sfx('whoosh', 0.8);
  const anim = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, filter: 'brightness(1)' },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 30}px) scale(${(s + 1) * 0.62}) rotateY(180deg) rotateZ(-6deg)`, filter: 'brightness(1.5)', offset: 0.5 },
      { transform: 'translate(0, -6px) scale(1.08) rotateY(360deg)', filter: 'brightness(1.15)', offset: 0.85 },
      { transform: 'translate(0, 0) scale(1) rotateY(360deg)', filter: 'brightness(1)' },
    ],
    { duration: 520, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' },
  );
  anim.onfinish = () => {
    to.style.visibility = '';
    to.classList.add('landed');
    ghost.remove();
  };
}

function burst(host: HTMLElement, n: number, color: string): void {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 110 + Math.random() * 160;
    const size = 4 + Math.random() * 8;
    const p = h('i', { class: 'upg-spark', style: `width:${size}px;height:${size}px;background:${i % 3 ? color : '#fff'}` });
    host.appendChild(p);
    p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist + 40}px)) scale(0.2)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 600, easing: 'cubic-bezier(0.1, 0.8, 0.3, 1)', fill: 'forwards' },
    ).onfinish = () => p.remove();
  }
}

/** Sparks that drift inward toward the card while it charges up. */
function converge(host: HTMLElement, n: number, color: string, ms: number): void {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * 120;
    const p = h('i', { class: 'upg-spark', style: `width:5px;height:5px;background:${color}` });
    host.appendChild(p);
    p.animate(
      [
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0.4)`, opacity: 0 },
        { opacity: 1, offset: 0.4 },
        { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 0 },
      ],
      { duration: 500 + Math.random() * 400, delay: Math.random() * (ms - 600), easing: 'ease-in', fill: 'both' },
    ).onfinish = () => p.remove();
  }
}

const RARITY_GLOW: Record<string, string> = { common: '#8cc0ff', rare: '#ffb347', epic: '#d27bff' };

function countUp(el: HTMLElement, from: number, to: number, ms: number): void {
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Full-screen upgrade ceremony, Clash Royale style: the card charges up, bursts with light,
 * its level ticks over, then the improved stats count up one by one. Call after the upgrade
 * has been applied; `onDone` runs when the player taps to continue.
 */
export function upgradeCeremony(id: string, oldLevel: number, newLevel: number, onDone: () => void): void {
  const c = CARDS[id];
  const glow = RARITY_GLOW[c.rarity] ?? '#ffd23f';
  const before = cardStats(id, oldLevel);
  const after = cardStats(id, newLevel);
  const card = cardView(id, { level: oldLevel });
  const lvl = card.querySelector('.lvl') as HTMLElement | null;
  const stats = h('div', { class: 'upg-stats' });
  const tap = h('div', { class: 'upg-tap' }, 'Tap to continue');
  const title = h('div', { class: 'upg-title display' }, h('span', null, 'Upgraded!'));
  const name = h('div', { class: 'upg-name display stroke' }, c.name);
  const flash = h('div', { class: 'upg-flash' });
  const ring = h('div', { class: 'upg-ring' });
  const fx = h('div', { class: 'upg-fx' });
  const cardWrap = h('div', { class: 'upg-card' }, card);
  const stage = h('div', { class: `upg-stage ${c.rarity}`, style: `--glow:${glow}` },
    h('div', { class: 'upg-rays' }),
    h('div', { class: 'upg-center' }, title, h('div', { class: 'upg-hero' }, ring, fx, cardWrap), name, stats),
    tap,
    flash,
  );
  app.root.appendChild(stage);

  const quick = reduced();
  const CHARGE = quick ? 0 : 1150;
  let finished = false;
  const timers: number[] = [];
  const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, quick ? 0 : ms));

  if (!quick) {
    sfx('charge');
    cardWrap.classList.add('charging');
    converge(fx, 26, glow, CHARGE);
  }
  later(CHARGE, () => {
    sfx('upgrade');
    sfx('crown', 0.6);
    cardWrap.classList.remove('charging');
    cardWrap.classList.add('popped');
    stage.classList.add('burst');
    if (lvl) lvl.textContent = `Level ${newLevel}`;
    lvl?.classList.add('lvl-pop');
    burst(fx, 36, glow);
  });
  const rows = after.map((s, i) => ({ s, old: before[i] })).filter(({ s, old }) => old && s.k === old.k);
  rows.forEach(({ s, old }, i) => {
    later(CHARGE + 600 + i * 230, () => {
      const v = h('span', { class: 'v' }, old.v);
      const changed = s.v !== old.v;
      const row = h('div', { class: `upg-row ${changed ? 'changed' : ''}` }, h('span', { class: 'k' }, s.k), v, changed && old.next ? h('span', { class: 'up' }, old.next) : null);
      stats.appendChild(row);
      const a = Number(old.v);
      const b = Number(s.v);
      if (changed && Number.isFinite(a) && Number.isFinite(b)) {
        sfx('stat', 0.7);
        countUp(v, a, b, 520);
      } else v.textContent = s.v;
    });
  });
  later(CHARGE + 700 + rows.length * 230, () => tap.classList.add('on'));

  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    sfx('click');
    stage.classList.add('out');
    window.setTimeout(() => {
      stage.remove();
      onDone();
    }, quick ? 0 : 220);
  };
  // Ignore taps until the burst so the moment can't be skipped by the same tap that started it.
  window.setTimeout(() => stage.addEventListener('click', finish), quick ? 0 : CHARGE + 300);
}
