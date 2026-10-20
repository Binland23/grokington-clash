import { sfx, startMusic, stopMusic, unlockAudio, vibrate } from '../audio/sfx';
import { AIController, type AIProfile } from '../engine/ai';
import { Battle, type BattleResult } from '../engine/battle';
import { CARDS, UNITS } from '../engine/cards';
import { POWERS } from '../engine/powers';
import type { BattleEvent, BattleMods } from '../engine/types';
import { kingLevel, levelsOf } from '../meta/profile';
import { Fx } from '../render/fx';
import { Scene3D, type DeployPreview, type PowerPreview } from '../render3d/scene3d';
import { spriteUrl } from '../render/sprites';
import { THEMES } from '../render/themes';
import { app, confirmModal, modal, onDispose, save } from './app';
import { h, img } from './dom';
import { cardView, crownIcon } from './widgets';

export interface EnemySetup {
  name: string;
  title: string;
  portrait: string;
  level: number;
  deck: string[];
  power: string | null;
  ai: AIProfile;
  towerHpMul: number;
  mods?: Partial<BattleMods>;
  taunt?: string;
}

export interface BattleSetup {
  enemy: EnemySetup;
  theme: string;
  playerMods?: Partial<BattleMods>;
  tutorial?: boolean;
  onEnd: (result: BattleResult, screen: HTMLElement, battle: Battle) => void;
}

const STEP = 1 / 60;

export function battleScreen(params: unknown): HTMLElement {
  const setup = params as BattleSetup;
  const profile = app.profile;
  const myLevel = kingLevel(profile);
  const enemyLevels = Object.fromEntries(Object.keys(CARDS).map((k) => [k, setup.enemy.level]));
  const battle = new Battle({
    decks: [profile.deck, setup.enemy.deck],
    levels: [levelsOf(profile), enemyLevels],
    towerLevels: [myLevel, setup.enemy.level],
    powers: [profile.power, setup.enemy.power],
    mods: [setup.playerMods, { ...setup.enemy.mods, towerHpMul: setup.enemy.towerHpMul }],
    seed: Math.floor(Math.random() * 1e9),
  });
  const ai = new AIController(battle, 1, setup.enemy.ai, Math.floor(Math.random() * 1e9));
  const fx = new Fx();
  const theme = THEMES[setup.theme] ?? THEMES.meadow;

  // ------------------------------------------------------------ DOM
  const canvas = h('canvas');
  const arena = h('div', { class: 'b-arena' }, canvas);
  const timerT = h('div', { class: 't' }, '3:00');
  const timerLbl = h('div', { class: 'lbl' }, 'Time left');
  const timer = h('div', { class: 'b-timer' }, timerLbl, timerT);
  const menuBtn = h('button', { class: 'icon-btn b-menu', 'aria-label': 'Menu' }, '☰');
  const top = h('div', { class: 'b-top' },
    h('div', { class: 'row', style: 'gap:6px' },
      menuBtn,
      h('div', { class: 'b-foe' },
        img(spriteUrl(setup.enemy.portrait)),
        h('div', null, h('div', { class: 'nm stroke' }, setup.enemy.name), h('div', { class: 'lv' }, `Level ${setup.enemy.level}`)),
      ),
    ),
    timer,
  );
  const foeCrowns = h('span', null, '0');
  const myCrowns = h('span', null, '0');
  const foeCrownBox = h('div', { class: 'c foe' }, crownIcon(), foeCrowns);
  const myCrownBox = h('div', { class: 'c' }, crownIcon(), myCrowns);
  arena.appendChild(h('div', { class: 'b-crowns' }, foeCrownBox, myCrownBox));

  const ring = (r: number, stroke: string, width: number) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bg.setAttribute('cx', '50');
    bg.setAttribute('cy', '50');
    bg.setAttribute('r', String(r));
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'rgba(0,0,0,0.35)');
    bg.setAttribute('stroke-width', String(width));
    const fg = bg.cloneNode() as SVGCircleElement;
    fg.setAttribute('stroke', stroke);
    fg.setAttribute('stroke-linecap', 'round');
    const len = 2 * Math.PI * r;
    fg.setAttribute('stroke-dasharray', `${len}`);
    fg.setAttribute('stroke-dashoffset', `${len}`);
    svg.append(bg, fg);
    return { svg, set: (f: number) => fg.setAttribute('stroke-dashoffset', String(len * (1 - f))) };
  };

  const myPower = profile.power ? POWERS[profile.power] : null;
  const powerRing = ring(46, myPower?.color ?? '#fff', 7);
  const powerBtn = h('button', { class: 'b-power', 'aria-label': 'Commander power' },
    powerRing.svg,
    h('span', { class: 'ico' }, myPower?.icon ?? '?'),
    h('span', { class: 'pname' }, myPower?.name ?? ''),
  );
  if (myPower) arena.appendChild(powerBtn);
  const foePowerDef = setup.enemy.power ? POWERS[setup.enemy.power] : null;
  const foeRing = ring(44, '#ff5a64', 8);
  if (foePowerDef) arena.appendChild(h('div', { class: 'b-foe-power', title: foePowerDef.name }, foeRing.svg, h('span', null, foePowerDef.icon)));

  const nextSlot = h('div', { class: 'b-next' }, h('div', { class: 'lbl' }, 'NEXT'), h('div', { style: 'width:100%;container-type:inline-size' }));
  const slots = [0, 1, 2, 3].map((i) => h('div', { class: 'hand-card', 'data-i': String(i) }));
  const manaNum = h('span', null, '5');
  const manaFill = h('div', { class: 'fill' });
  const manaRow = h('div', { class: 'b-mana' },
    h('div', { class: 'drop' }, img(spriteUrl('ui_mana')), manaNum),
    h('div', { class: 'bar' }, manaFill, h('div', { class: 'ticks' }, ...Array.from({ length: 10 }, () => h('i')))),
  );
  const bottom = h('div', { class: 'b-bottom' }, h('div', { class: 'b-hand' }, nextSlot, ...slots), manaRow);
  const root = h('div', { class: 'screen battle' }, top, arena, bottom);

  const renderer = new Scene3D(canvas, theme);
  const fpsEl = new URLSearchParams(location.search).has('fps')
    ? h('div', { style: 'position:absolute;left:4px;top:50%;z-index:9;font:12px monospace;background:rgba(0,0,0,.6);padding:2px 5px;border-radius:4px;pointer-events:none' })
    : null;
  if (fpsEl) arena.appendChild(fpsEl);
  let fpsFrames = 0;
  let fpsT = 0;
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__game = { battle, fx, renderer, ai };
  const ro = new ResizeObserver(() => renderer.resize());
  ro.observe(arena);

  // ------------------------------------------------------------ helpers
  const banner = (text: string, sub = '', color = '#fff') => {
    const b = h('div', { class: 'b-banner', style: `color:${color}` }, text, sub ? h('small', null, sub) : null);
    arena.appendChild(b);
    setTimeout(() => b.remove(), 1900);
  };
  let toastEl: HTMLElement | null = null;
  const toast = (msg: string) => {
    toastEl?.remove();
    toastEl = h('div', { class: 'b-toast' }, msg);
    arena.appendChild(toastEl);
    const mine = toastEl;
    setTimeout(() => mine.remove(), 1100);
  };

  // ------------------------------------------------------------ hand
  let shownHand: string[] = [];
  let shownNext = '';
  let selected: number | null = null;
  const renderHand = () => {
    const p = battle.players[0];
    p.hand.forEach((id, i) => {
      if (shownHand[i] === id) return;
      const slot = slots[i];
      slot.innerHTML = '';
      slot.append(cardView(id, { cost: false }), h('div', { class: 'hc-cost' }, String(CARDS[id].cost)));
      slot.classList.remove('enter');
      void slot.offsetWidth;
      slot.classList.add('enter');
    });
    shownHand = p.hand.slice();
    const next = battle.nextCard(0) ?? '';
    if (next !== shownNext) {
      shownNext = next;
      const holder = nextSlot.lastElementChild as HTMLElement;
      holder.innerHTML = '';
      if (next) holder.appendChild(cardView(next));
    }
  };
  const setSelected = (i: number | null) => {
    selected = i;
    slots.forEach((s, k) => s.classList.toggle('selected', k === i));
  };

  // ------------------------------------------------------------ input
  let preview: DeployPreview | null = null;
  let powerPreview: PowerPreview | null = null;
  let powerArmed = false;
  let drag: { i: number; el: HTMLElement; moved: boolean; sx: number; sy: number; overArena: boolean } | null = null;
  let tutorialEl: HTMLElement | null = null;

  const overArena = (cx: number, cy: number) => {
    const r = arena.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  const tryDeploy = (i: number, cx: number, cy: number): boolean => {
    if (!started || battle.phase === 'ended') return false;
    const p = battle.players[0];
    const id = p.hand[i];
    const t = renderer.toTile(cx, cy);
    const pos = battle.placement(0, id, t.x, t.y);
    if (!pos) {
      toast("Can't deploy there");
      sfx('nope');
      return false;
    }
    if (p.mana < CARDS[id].cost) {
      toast('Not enough mana!');
      sfx('nope');
      return false;
    }
    if (battle.deploy(0, i, t.x, t.y)) {
      if (tutorialEl) {
        tutorialEl.remove();
        tutorialEl = null;
        profile.seenTutorial = true;
        save();
      }
      return true;
    }
    return false;
  };
  const updatePreview = (i: number, cx: number, cy: number) => {
    const id = battle.players[0].hand[i];
    const t = renderer.toTile(cx, cy);
    const pos = battle.placement(0, id, t.x, t.y);
    const ok = !!pos && battle.players[0].mana >= CARDS[id].cost;
    preview = pos ? { cardId: id, x: pos.x, y: pos.y, ok } : { cardId: id, x: t.x, y: t.y, ok: false };
  };

  slots.forEach((slot, i) => {
    slot.addEventListener('pointerdown', (e) => {
      if (!started || battle.phase === 'ended') return;
      unlockAudio();
      e.preventDefault();
      powerArmed = false;
      powerPreview = null;
      slot.setPointerCapture(e.pointerId);
      const id = battle.players[0].hand[i];
      const el = h('div', { class: 'drag-card' }, cardView(id));
      el.style.display = 'none';
      root.appendChild(el);
      drag = { i, el, moved: false, sx: e.clientX, sy: e.clientY, overArena: false };
      setSelected(i);
      sfx('card');
    });
    slot.addEventListener('pointermove', (e) => {
      if (!drag || drag.i !== i) return;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
      if (!drag.moved) return;
      const rr = root.getBoundingClientRect();
      drag.overArena = overArena(e.clientX, e.clientY);
      slot.classList.add('dragging');
      if (drag.overArena) {
        drag.el.style.display = 'none';
        updatePreview(i, e.clientX, e.clientY);
      } else {
        drag.el.style.display = '';
        drag.el.style.left = `${e.clientX - rr.left}px`;
        drag.el.style.top = `${e.clientY - rr.top}px`;
        preview = null;
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!drag || drag.i !== i) return;
      const d = drag;
      drag = null;
      d.el.remove();
      slot.classList.remove('dragging');
      preview = null;
      if (cancelled) return;
      if (d.moved && overArena(e.clientX, e.clientY)) {
        if (tryDeploy(i, e.clientX, e.clientY)) setSelected(null);
      } else if (d.moved) {
        setSelected(null);
      }
    };
    slot.addEventListener('pointerup', (e) => end(e, false));
    slot.addEventListener('pointercancel', (e) => end(e, true));
  });

  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    if (!started || battle.phase === 'ended') return;
    const t = renderer.toTile(e.clientX, e.clientY);
    if (powerArmed) {
      const pt = battle.powerTarget(0, t.x, t.y);
      if (pt && battle.usePower(0, pt.x, pt.y)) {
        powerArmed = false;
        powerPreview = null;
        powerBtn.classList.remove('armed');
      }
      return;
    }
    if (selected !== null) {
      if (tryDeploy(selected, e.clientX, e.clientY)) setSelected(null);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) return;
    if (powerArmed && myPower) {
      const t = renderer.toTile(e.clientX, e.clientY);
      const pt = battle.powerTarget(0, t.x, t.y);
      if (pt) powerPreview = { x: pt.x, y: pt.y, radius: myPower.radius ?? 1.5, color: myPower.color };
    } else if (selected !== null && e.pointerType === 'mouse') {
      updatePreview(selected, e.clientX, e.clientY);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (!drag) preview = null;
  });

  powerBtn.addEventListener('click', () => {
    unlockAudio();
    if (!started || !myPower) return;
    if (!battle.canUsePower(0)) {
      toast(`${myPower.name} is charging...`);
      return;
    }
    if (myPower.targeting === 'none') {
      battle.usePower(0);
      return;
    }
    powerArmed = !powerArmed;
    powerBtn.classList.toggle('armed', powerArmed);
    setSelected(null);
    if (powerArmed) {
      toast(`Tap the arena to unleash ${myPower.name}`);
      const pt = battle.powerTarget(0, 9, 22)!;
      powerPreview = { x: pt.x, y: pt.y, radius: myPower.radius ?? 1.5, color: myPower.color };
    } else powerPreview = null;
  });

  let paused = false;
  menuBtn.addEventListener('click', () => {
    sfx('click');
    paused = true;
    const m = modal(
      h('div', null,
        h('h2', { class: 'stroke' }, 'Paused'),
        h('div', { style: 'display:flex;flex-direction:column;gap:10px;align-items:stretch' },
          h('button', { class: 'btn btn-green', onclick: () => { sfx('click'); m.close(); } }, 'Resume'),
          h('button', {
            class: 'btn btn-red',
            onclick: () => {
              m.close();
              confirmModal('Surrender?', 'You will lose this battle.', 'Surrender', () => battle.forfeit(0), true);
            },
          }, 'Surrender'),
        ),
      ),
      { onClose: () => (paused = false) },
    );
  });

  // ------------------------------------------------------------ events -> fx/sfx
  const unitById = (id: number) => battle.units.find((u) => u.id === id);
  const deploying = new Set<number>();
  let lastWarn = 0;

  const handle = (e: BattleEvent) => {
    switch (e.type) {
      case 'deploy': {
        const c = CARDS[e.card];
        if (c.type !== 'spell') sfx('deploy', 0.8);
        if (e.team === 1) fx.text(e.x, e.y - 1.2, c.name, '#ff8a90', 0.55, 1.2);
        break;
      }
      case 'spawn':
        deploying.add(e.id);
        break;
      case 'attack': {
        const u = unitById(e.id);
        if (e.kind === 'arrow' || e.kind === 'bolt') sfx('arrow', 0.5);
        else if (e.kind === 'bullet' || e.kind === 'cannon') sfx('shot', e.kind === 'cannon' ? 0.7 : 0.45);
        else if (e.kind === 'fire') sfx('fire', 0.4);
        if (u && (e.kind === 'cannon' || e.kind === 'bullet')) {
          fx.burst(u.x, u.y - 0.2, 3, { kind: 'smoke', color: '#dddddd', speed: 0.6, up: 1, gravity: 0, max: 0.5, size: 0.18, z: u.kind === 'tower' ? 3 : 1 });
        }
        break;
      }
      case 'hit': {
        fx.burst(e.x, e.y, e.heavy ? 7 : 3, {
          kind: 'spark',
          colors: e.heavy ? ['#fff3b0', '#ffb347', '#ffffff'] : ['#ffffff', '#ffe9a8'],
          speed: e.heavy ? 3.5 : 2,
          up: 2.5,
          z: e.air ? 1.6 : 0.6,
          max: 0.35,
          size: e.heavy ? 0.13 : 0.09,
        });
        sfx(e.heavy ? 'heavy' : 'hit', e.heavy ? 0.7 : 0.35);
        break;
      }
      case 'heal':
        fx.burst(e.x, e.y, 2, { kind: 'heal', colors: ['#9dff8a', '#fff59a'], speed: 0.4, up: 1.6, gravity: -0.5, max: 0.8, size: 0.16, z: 0.8 });
        break;
      case 'death': {
        const big = e.big;
        fx.burst(e.x, e.y, big ? 14 : 7, { kind: 'smoke', colors: ['#ffffff', '#e6e6e6', '#cfcfcf'], speed: big ? 2 : 1.3, up: 1.2, gravity: 0.5, max: 0.7, size: big ? 0.4 : 0.25 });
        if (big) fx.burst(e.x, e.y, 10, { kind: 'debris', colors: ['#8a6a4a', '#9a958c', '#5a4a3a'], speed: 3, up: 4, max: 0.9, size: 0.18 });
        const st = Object.values(UNITS).find((s) => s.sprite === e.sprite);
        if (e.kind !== 'tower') fx.ghost({ sprite: e.sprite, team: e.team, x: e.x, y: e.y, h: st?.height ?? 1.5, flying: !!st?.flying });
        sfx('death', 0.5);
        break;
      }
      case 'tower_down': {
        fx.burst(e.x, e.y, 40, { kind: 'debris', colors: ['#9a958c', '#7d786f', '#b8b2a6', '#5c574f'], speed: 5, up: 6, max: 1.4, size: 0.3 });
        fx.burst(e.x, e.y, 30, { kind: 'smoke', colors: ['#ffffff', '#d8d8d8', '#bbbbbb'], speed: 2.5, up: 1.5, gravity: 0.2, max: 1.4, size: 0.6 });
        fx.burst(e.x, e.y, 20, { kind: 'spark', colors: ['#ffd27a', '#ff8a2a'], speed: 5, up: 5, max: 0.6 });
        fx.ring(e.x, e.y, 4, '#ffffff', 0.6, 0.2);
        fx.glow(e.x, e.y, 12, '#ffd9a0', 0.8, 2);
        fx.addShake(0.6);
        fx.flash = 0.35;
        fx.flashColor = '#fff3d0';
        slowT = e.towerType === 'keep' ? 1.1 : 0.55;
        sfx('tower');
        vib([60, 40, 120]);
        const mine = e.team === 1;
        setTimeout(() => {
          sfx('crown');
          fx.text(e.x, e.y - 2.2, mine ? '+1 👑' : '-1 👑', mine ? '#ffd23f' : '#ff6b74', 1.1, 1.8);
          (mine ? myCrownBox : foeCrownBox).classList.add('pop');
          setTimeout(() => (mine ? myCrownBox : foeCrownBox).classList.remove('pop'), 1300);
        }, 350);
        break;
      }
      case 'impact':
        impactFx(e.fx, e.x, e.y, e.radius);
        break;
      case 'spell':
        spellFx(e.fx, e.x, e.y, e.radius, e.team);
        break;
      case 'power': {
        const def = POWERS[e.id];
        sfx('power');
        vib(40);
        banner(def.name + '!', e.team === 0 ? '' : `${setup.enemy.name} strikes!`, e.team === 0 ? def.color : '#ff6b74');
        if (e.id === 'rally') {
          for (const u of battle.units) if (u.team === e.team && u.kind === 'troop') fx.ring(u.x, u.y, 1, '#d36bff', 0.6, 0.12);
          sfx('rage');
        }
        if (e.x !== undefined && e.y !== undefined && (e.id === 'imphorde' || e.id === 'raisedead' || e.id === 'bulwark')) {
          fx.ring(e.x, e.y, 2.2, def.color, 0.7, 0.18);
          fx.burst(e.x, e.y, 18, { kind: 'dust', colors: ['#d8c8a8', '#bba98a'], speed: 2, up: 0.5, gravity: 0.5, max: 0.8, size: 0.3 });
        }
        break;
      }
      case 'keep_awake':
        break;
      case 'double_mana':
        banner('2x MANA!', 'Last 60 seconds', '#ff9af0');
        sfx('power', 0.6);
        manaRow.classList.add('double');
        break;
      case 'overtime':
        banner('OVERTIME', 'Next crown wins!', '#ff9a3d');
        sfx('power', 0.6);
        timer.classList.add('ot');
        timerLbl.textContent = 'Overtime';
        break;
      case 'end':
        onBattleEnd();
        break;
    }
  };

  const vib = (ms: number | number[]) => {
    if (profile.settings.vibrate) vibrate(ms);
  };

  const impactFx = (kind: string, x: number, y: number, r: number) => {
    switch (kind) {
      case 'fire':
      case 'meteor': {
        const big = kind === 'meteor';
        fx.burst(x, y, big ? 50 : 30, { kind: 'ember', colors: ['#fff3b0', '#ffb347', '#ff6a2a', '#ff3d1a'], speed: big ? 6 : 4.5, up: 4, max: 0.8, size: 0.16 });
        fx.burst(x, y, big ? 24 : 14, { kind: 'smoke', colors: ['#5a4a42', '#3d3330', '#7a6a60'], speed: 2, up: 1.5, gravity: 0.3, max: 1.2, size: 0.5 });
        fx.ring(x, y, r, '#ffb347', 0.45, 0.25, 0.2, 'rgba(255,140,40,0.25)');
        fx.glow(x, y, r * (big ? 5 : 3.6), '#ff9a3a', big ? 0.6 : 0.45, 0.8);
        fx.decal(x, y, r * 0.75, big ? 'crater' : 'scorch', 7);
        fx.addShake(big ? 0.55 : 0.3);
        sfx('boom', big ? 1 : 0.75);
        vib(big ? 90 : 40);
        break;
      }
      case 'bomb':
        fx.burst(x, y, 22, { kind: 'ember', colors: ['#fff3b0', '#ffb347', '#ff6a2a'], speed: 4, up: 3.5, max: 0.6, size: 0.14 });
        fx.burst(x, y, 12, { kind: 'smoke', colors: ['#444', '#666', '#888'], speed: 1.8, up: 1.2, gravity: 0.2, max: 1, size: 0.45 });
        fx.ring(x, y, r, '#ffd27a', 0.4, 0.2);
        fx.glow(x, y, r * 3.5, '#ffb04a', 0.4, 0.6);
        fx.decal(x, y, r * 0.6, 'scorch', 5);
        fx.addShake(0.25);
        sfx('boom', 0.6);
        break;
      case 'arrows':
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * r;
          fx.burst(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85, 2, { kind: 'dust', colors: ['#d9c8a6', '#c4b08a'], speed: 0.8, up: 0.8, max: 0.4, size: 0.12 });
        }
        sfx('arrow', 0.8);
        break;
      case 'zap':
        fx.ring(x, y, r, '#bff4ff', 0.3, 0.15, 0.2, 'rgba(160,230,255,0.25)');
        fx.glow(x, y, r * 3, '#9fe8ff', 0.3, 0.8);
        break;
      case 'freeze':
        break;
      case 'spin':
        fx.ring(x, y, r, 'rgba(255,255,255,0.8)', 0.25, 0.12, r * 0.4);
        break;
      default:
        // Splash projectiles (wyrmling / pyromancer fire).
        fx.burst(x, y, 10, { kind: 'ember', colors: ['#fff3b0', '#ffb347', '#ff6a2a'], speed: 2.5, up: 2.5, max: 0.45, size: 0.12, z: 0.3 });
        fx.glow(x, y, r * 2.6, '#ffa040', 0.3, 0.5);
        fx.ring(x, y, r, 'rgba(255,170,60,0.85)', 0.3, 0.12);
    }
  };

  const spellFx = (kind: string, x: number, y: number, r: number, team: 0 | 1) => {
    switch (kind) {
      case 'zap':
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * r * 0.8;
          fx.bolt(x + Math.cos(a) * d + (Math.random() - 0.5), y + Math.sin(a) * d, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85, '#bff4ff', 0.12, 0.3, 9, 0);
        }
        fx.burst(x, y, 16, { kind: 'spark', colors: ['#ffffff', '#bff4ff', '#6fd6ff'], speed: 4, up: 3, max: 0.4 });
        fx.flash = 0.15;
        fx.flashColor = '#cff6ff';
        sfx('zap');
        break;
      case 'thunder':
        fx.bolt(x + (Math.random() - 0.5) * 2, y - 1, x, y, '#fff6a0', 0.22, 0.4, 14, 0);
        fx.bolt(x + (Math.random() - 0.5) * 2, y - 1, x, y, '#ffffff', 0.12, 0.35, 14, 0);
        fx.burst(x, y, 20, { kind: 'spark', colors: ['#ffffff', '#fff6a0', '#ffd23f'], speed: 5, up: 4, max: 0.5 });
        fx.ring(x, y, 1.6, '#fff6a0', 0.4, 0.2);
        fx.glow(x, y, 6, '#fff6c0', 0.45, 1);
        fx.addShake(0.3);
        fx.flash = 0.25;
        fx.flashColor = '#fffbe0';
        sfx('zap');
        sfx('boom', 0.5);
        break;
      case 'freeze':
        fx.ring(x, y, r, '#e6fbff', 0.5, 0.22, 0.3, 'rgba(180,240,255,0.35)');
        fx.decal(x, y, r, 'ice', 4.2);
        fx.burst(x, y, 30, { kind: 'snow', colors: ['#ffffff', '#d9f6ff', '#9fe6ff'], speed: 3, up: 2.5, gravity: 1.5, max: 1, size: 0.12 });
        sfx('freeze');
        break;
      case 'rage':
        fx.ring(x, y, r, '#d36bff', 0.6, 0.2, 0.3);
        sfx('rage');
        break;
      case 'heal':
        fx.ring(x, y, r, '#a6ff8a', 0.6, 0.18, 0.3);
        fx.burst(x, y, 20, { kind: 'heal', colors: ['#9dff8a', '#fff59a'], speed: 1.5, up: 2, gravity: -0.4, max: 1.2, size: 0.18 });
        sfx('heal');
        break;
      case 'fire':
        sfx('fire', 0.8);
        break;
      case 'arrows':
        sfx('arrow', 0.8);
        break;
    }
    void team;
  };

  // ------------------------------------------------------------ hud
  const fmtTime = (s: number) => {
    const t = Math.ceil(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  let lastManaInt = -1;
  const updateHud = () => {
    const p = battle.players[0];
    renderHand();
    const mana = p.mana;
    manaFill.style.width = `${(mana / 10) * 100}%`;
    const mi = Math.floor(mana);
    if (mi !== lastManaInt) {
      manaNum.textContent = String(mi);
      lastManaInt = mi;
    }
    p.hand.forEach((id, i) => slots[i].classList.toggle('poor', CARDS[id].cost > mana));
    const left = battle.timeLeft();
    timerT.textContent = fmtTime(left);
    const low = battle.phase !== 'overtime' && left <= 10 && left > 0;
    timer.classList.toggle('low', low);
    if (low && Math.ceil(left) !== lastWarn) {
      lastWarn = Math.ceil(left);
      sfx('tick');
    }
    myCrowns.textContent = String(battle.players[0].crowns);
    foeCrowns.textContent = String(battle.players[1].crowns);
    if (myPower) {
      const c = battle.players[0].power.charge;
      powerRing.set(c);
      const ready = c >= 1;
      if (ready !== powerBtn.classList.contains('ready')) {
        powerBtn.classList.toggle('ready', ready);
        if (ready) sfx('reward', 0.6);
      }
    }
    if (foePowerDef) foeRing.set(battle.players[1].power.charge);
  };

  // ------------------------------------------------------------ loop
  let started = false;
  let disposed = false;
  let endTimer = 0;
  let ended = false;
  let last = performance.now();
  let acc = 0;
  /** Brief slow motion for dramatic moments (a tower falling). */
  let slowT = 0;

  const onBattleEnd = () => {
    if (ended) return;
    ended = true;
    setSelected(null);
    preview = null;
    const r = battle.result!;
    banner(r.winner === 0 ? 'VICTORY!' : r.winner === 1 ? 'DEFEAT' : 'DRAW', '', r.winner === 0 ? '#ffd23f' : r.winner === 1 ? '#ff6b74' : '#fff');
    stopMusic();
    endTimer = window.setTimeout(() => {
      if (disposed) return;
      sfx(r.winner === 0 ? 'win' : 'lose');
      setup.onEnd(r, root, battle);
    }, 2400);
  };

  const frame = (now: number) => {
    if (disposed) return;
    const rawDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    slowT = Math.max(0, slowT - rawDt);
    const dt = slowT > 0 ? rawDt * 0.3 : rawDt;
    const running = started && !paused && !document.hidden && !tutorialEl;
    if (running && battle.phase !== 'ended') {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        ai.update(STEP);
        battle.update(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === 6) acc = 0;
    }
    for (const e of battle.events) handle(e);
    battle.events.length = 0;
    // Landing dust when a unit finishes deploying.
    for (const id of deploying) {
      const u = unitById(id);
      if (!u) {
        deploying.delete(id);
        continue;
      }
      if (u.deployT <= 0) {
        deploying.delete(id);
        if (!u.flying) {
          fx.burst(u.x, u.y + u.s.radius * 0.4, u.s.radius > 0.6 ? 12 : 5, { kind: 'dust', colors: ['#e8dcc0', '#d1c3a3'], speed: 1.6, up: 0.6, gravity: 1, max: 0.5, size: 0.2 });
          if (u.s.radius >= 0.7) {
            fx.addShake(0.15);
            fx.ring(u.x, u.y, 1.4, 'rgba(255,255,255,0.6)', 0.35, 0.08);
          }
        }
      }
    }
    fx.update(running || ended ? dt : 0);
    // Let the camera finish its entrance while the tutorial pauses combat.
    renderer.render(battle, fx, (started && !paused && !document.hidden) || ended ? dt : 0, preview, powerArmed ? powerPreview : null);
    for (const s of renderer.pendingSmoke) fx.burst(s.x, s.y, 1, { kind: 'smoke', colors: ['#555', '#777'], speed: 0.3, up: 1.2, gravity: -0.6, max: 1.6, size: 0.25, z: 2.5 });
    renderer.pendingSmoke.length = 0;
    updateHud();
    if (fpsEl) {
      fpsFrames++;
      fpsT += rawDt;
      if (fpsT >= 0.5) {
        const info = renderer.renderer.info.render;
        fpsEl.textContent = `${Math.round(fpsFrames / fpsT)} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris · ${battle.units.length} units`;
        fpsFrames = 0;
        fpsT = 0;
      }
    }
    requestAnimationFrame(frame);
  };

  // ------------------------------------------------------------ intro
  const intro = h('div', { class: 'vs', onclick: () => startBattle() },
    h('div', { class: 'side foe' },
      img(spriteUrl(setup.enemy.portrait)),
      h('div', null,
        h('div', { class: 'nm stroke' }, setup.enemy.name),
        h('div', { class: 'sub' }, `${setup.enemy.title} · Level ${setup.enemy.level}`),
        setup.enemy.taunt ? h('div', { class: 'quote' }, `“${setup.enemy.taunt}”`) : null,
      ),
    ),
    h('div', { class: 'big' }, 'VS'),
    h('div', { class: 'side me' },
      img(spriteUrl('portrait_hero')),
      h('div', null, h('div', { class: 'nm stroke' }, profile.name), h('div', { class: 'sub' }, `Banner Lord · Level ${myLevel}`)),
    ),
    h('div', { class: 'tap muted', style: 'margin-top:18px;font-size:16px' }, 'Tap to begin'),
  );
  root.appendChild(intro);
  let introTimer = window.setTimeout(() => startBattle(), setup.enemy.taunt ? 4200 : 2600);

  function startBattle() {
    if (started || disposed) return;
    clearTimeout(introTimer);
    unlockAudio();
    intro.remove();
    started = true;
    last = performance.now();
    renderer.playIntro();
    banner('FIGHT!', '', '#ffd23f');
    sfx('power', 0.7);
    startMusic(setup.enemy.ai.skill > 0.7 ? 1 : 0);
    if (setup.tutorial) {
      tutorialEl = h('div', { class: 'tutorial' },
        h('div', { class: 'hand' }, '👇'),
        'Drag a card onto your side of the arena!',
        h('div', { style: 'font-family:var(--body);font-size:13px;font-weight:700;margin-top:4px' },
          'The battle waits for your first card. Each card costs mana (pink bar). Put a Brute or Knight in front of your ranged troops, then push toward a tower!'),
      );
      arena.appendChild(tutorialEl);
    }
  }

  const onVis = () => {
    last = performance.now();
  };
  document.addEventListener('visibilitychange', onVis);
  requestAnimationFrame((t) => {
    last = t;
    renderer.resize();
    frame(t);
  });

  onDispose(root, () => {
    disposed = true;
    clearTimeout(endTimer);
    clearTimeout(introTimer);
    ro.disconnect();
    renderer.dispose();
    stopMusic();
    document.removeEventListener('visibilitychange', onVis);
  });
  return root;
}
