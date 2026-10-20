import { sfx } from '../audio/sfx';
import { AI_PROFILES } from '../engine/ai';
import type { BattleResult } from '../engine/battle';
import { CARDS } from '../engine/cards';
import { POWERS } from '../engine/powers';
import { REGIONS, STAGES, stageOpponentName, type Stage } from '../meta/campaign';
import {
  BOONS,
  CHEST_INFO,
  addChest,
  applyLoot,
  boonMods,
  kingLevel,
  rollChest,
  unlockCard,
  recordCampaignClear,
  type ChestType,
} from '../meta/profile';
import { spriteUrl } from '../render/sprites';
import { app, go, modal, save } from './app';
import { fmt, h, img } from './dom';
import { cardView, crownIcon } from './widgets';

interface RewardTile {
  icon: Node;
  label: string;
}

const goldTile = (n: number): RewardTile => ({ icon: img(spriteUrl('ui_gold')), label: `+${fmt(n)} gold` });
const chestTile = (t: ChestType, stored: boolean): RewardTile => ({
  icon: img(spriteUrl(CHEST_INFO[t].sprite)),
  label: stored ? CHEST_INFO[t].name : 'Slots full: +gold',
});

export function nextStageIndex(): number {
  for (const s of STAGES) if (!(app.profile.cleared[s.index] > 0)) return s.index;
  return STAGES.length - 1;
}

export function stageUnlocked(i: number): boolean {
  return i === 0 || app.profile.cleared[i - 1] > 0;
}

// ---------------------------------------------------------------- campaign

export function startCampaignStage(index: number): void {
  const s = STAGES[index];
  const r = REGIONS[s.region];
  go('battle', {
    enemy: {
      name: s.boss ? r.warlord : stageOpponentName(s),
      title: s.boss ? r.title : r.name,
      portrait: r.portrait,
      level: s.level,
      deck: s.deck,
      power: s.power,
      ai: s.ai,
      towerHpMul: s.towerHpMul,
      mods: s.enemyMods,
      taunt: s.boss ? r.taunt : undefined,
    },
    theme: r.theme,
    tutorial: index === 0 && !app.profile.seenTutorial,
    onEnd: (res: BattleResult, screen: HTMLElement) => campaignResult(s, res, screen),
  });
}

function recordStats(res: BattleResult): void {
  const st = app.profile.stats;
  if (res.winner === 0) st.wins++;
  else if (res.winner === 1) st.losses++;
  else st.draws++;
  st.crowns += res.crowns[0];
  if (res.crowns[0] === 3) st.threeCrowns++;
}

function campaignResult(s: Stage, res: BattleResult, screen: HTMLElement): void {
  const p = app.profile;
  recordStats(res);
  const tiles: RewardTile[] = [];
  let note = '';
  const r = REGIONS[s.region];
  if (res.winner === 0) {
    const first = recordCampaignClear(p, s.index, res.crowns[0]);
    if (first) {
      tiles.push({ icon: h('div', { class: 'big-ico' }, '🃏'), label: '+2 copies of every deck card' });
      p.gold += s.reward.gold;
      tiles.push(goldTile(s.reward.gold));
      tiles.push(chestTile(s.reward.chest, addChest(p, s.reward.chest)));
      if (s.reward.card && unlockCard(p, s.reward.card)) {
        tiles.push({ icon: h('div', { style: 'width:64px;margin:0 auto 4px;container-type:inline-size' }, cardView(s.reward.card)), label: `New: ${CARDS[s.reward.card].name}` });
      }
      if (s.reward.power && !p.powers.includes(s.reward.power)) {
        p.powers.push(s.reward.power);
        const pw = POWERS[s.reward.power];
        tiles.push({ icon: h('div', { class: 'big-ico' }, pw.icon), label: `Power: ${pw.name}` });
      }
      if (s.boss) note = `“${r.defeat}”`;
    } else {
      const g = Math.round(s.reward.gold * 0.35);
      p.gold += g;
      tiles.push(goldTile(g));
      if (res.crowns[0] === 3) tiles.push(chestTile('wood', addChest(p, 'wood')));
    }
  } else {
    const g = 10 + res.crowns[0] * 15;
    p.gold += g;
    tiles.push(goldTile(g));
    note = res.winner === 1 ? 'Upgrade your cards or try a different deck, then strike back!' : '';
  }
  save();
  showResults(screen, res, tiles, note, [
    { label: 'Map', cls: 'btn-blue', run: () => go('map') },
    { label: 'Continue', cls: 'btn-gold', run: () => go('home') },
  ]);
}

// ---------------------------------------------------------------- gauntlet

export function startGauntletRun(): void {
  const p = app.profile;
  p.gauntlet.run = { wins: 0, boons: [], deck: p.deck.slice(), power: p.power, offer: null };
  save();
  startGauntletBattle();
}

export function startGauntletBattle(): void {
  const p = app.profile;
  const run = p.gauntlet.run;
  if (!run) return;
  const wins = run.wins;
  const region = wins % REGIONS.length;
  const boss = (wins + 1) % 5 === 0;
  const s = STAGES[region * 4 + (boss ? 3 : Math.floor(Math.random() * 3))];
  const r = REGIONS[s.region];
  const level = Math.max(1, Math.min(10, kingLevel(p) + Math.floor(wins / 3) - 1));
  const aiName = wins < 2 ? 'easy' : wins < 5 ? 'normal' : wins < 10 ? 'hard' : 'brutal';
  go('battle', {
    enemy: {
      name: boss ? r.warlord : stageOpponentName(s),
      title: `Gauntlet battle ${wins + 1}`,
      portrait: r.portrait,
      level,
      deck: s.deck,
      power: boss ? r.power : wins >= 3 ? 'rally' : null,
      ai: { ...AI_PROFILES[aiName], openingDelay: wins < 2 ? 8 : 4 },
      mods: { manaRate: wins < 2 ? 0.85 : 1 },
      towerHpMul: boss ? 1.1 : 1,
      taunt: boss ? r.taunt : undefined,
    },
    theme: r.theme,
    playerMods: boonMods(run.boons),
    onEnd: (res: BattleResult, screen: HTMLElement) => gauntletResult(res, screen),
  });
}

function rollBoons(): string[] {
  const ids = BOONS.map((b) => b.id);
  const out: string[] = [];
  while (out.length < 3) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function gauntletResult(res: BattleResult, screen: HTMLElement): void {
  const p = app.profile;
  const run = p.gauntlet.run!;
  recordStats(res);
  const tiles: RewardTile[] = [];
  if (res.winner === 0) {
    run.wins++;
    const g = 40 + run.wins * 20;
    p.gold += g;
    tiles.push(goldTile(g));
    const milestone: Record<number, ChestType> = { 3: 'silver', 6: 'gold', 10: 'royal' };
    const chest = milestone[run.wins] ?? (run.wins > 10 && run.wins % 5 === 0 ? 'gold' : null);
    if (chest) tiles.push(chestTile(chest, addChest(p, chest)));
    p.gauntlet.best = Math.max(p.gauntlet.best, run.wins);
    run.offer = rollBoons();
    save();
    showResults(screen, res, tiles, `Gauntlet: ${run.wins} win${run.wins === 1 ? '' : 's'} in a row!`, [
      { label: 'Choose a boon', cls: 'btn-gold', run: () => go('gauntlet') },
    ]);
  } else {
    const final = run.wins;
    p.gauntlet.best = Math.max(p.gauntlet.best, final);
    p.gauntlet.run = null;
    const g = 15 + final * 10;
    p.gold += g;
    tiles.push(goldTile(g));
    save();
    showResults(screen, res, tiles, `Your run ends at ${final} win${final === 1 ? '' : 's'}. Best: ${p.gauntlet.best}.`, [
      { label: 'Continue', cls: 'btn-gold', run: () => go('gauntlet') },
    ]);
  }
}

// ---------------------------------------------------------------- results overlay

function showResults(
  screen: HTMLElement,
  res: BattleResult,
  tiles: RewardTile[],
  note: string,
  buttons: { label: string; cls: string; run: () => void }[],
): void {
  const win = res.winner === 0;
  const crowns = [0, 1, 2].map((i) => {
    const c = crownIcon(i < res.crowns[0] ? 'on' : '');
    if (i < res.crowns[0]) c.style.animationDelay = `${0.4 + i * 0.25}s`;
    return c;
  });
  const el = h('div', { class: 'results' },
    h('div', { class: `title ${win ? 'win' : 'lose'}` }, win ? 'VICTORY' : res.winner === 1 ? 'DEFEAT' : 'DRAW'),
    h('div', { class: 'crowns' }, ...crowns),
    h('div', { class: 'muted', style: 'font-weight:800' }, `${res.crowns[0]} - ${res.crowns[1]}`),
    note ? h('div', { class: 'center', style: 'font-weight:800;max-width:320px;font-style:italic' }, note) : null,
    tiles.length ? h('div', { class: 'reward-list' }, ...tiles.map((t, i) => h('div', { class: 'reward panel', style: `animation-delay:${0.8 + i * 0.18}s` }, t.icon, t.label))) : null,
    h('div', { class: 'row', style: 'margin-top:8px' },
      ...buttons.map((b) => h('button', { class: `btn ${b.cls}`, onclick: () => { sfx('click'); b.run(); } }, b.label)),
    ),
  );
  screen.appendChild(el);
  tiles.forEach((_, i) => setTimeout(() => sfx('reward', 0.7), 800 + i * 180));
  if (win) confetti(el);
}

/** A quick confetti shower drawn on a canvas inside the results overlay. */
function confetti(host: HTMLElement): void {
  const c = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none' });
  host.prepend(c);
  const r = host.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = r.width * dpr;
  c.height = r.height * dpr;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const colors = ['#ffd23f', '#3d8bff', '#ff4b55', '#5fd040', '#c46bff', '#ffffff'];
  const bits = Array.from({ length: 140 }, () => ({
    x: r.width / 2 + (Math.random() - 0.5) * 60,
    y: r.height * 0.3,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 11 - 3,
    s: 4 + Math.random() * 6,
    a: Math.random() * 6,
    va: (Math.random() - 0.5) * 0.4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  let t = 0;
  const step = () => {
    t++;
    g.clearRect(0, 0, r.width, r.height);
    for (const b of bits) {
      b.vy += 0.25;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.a += b.va;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.a);
      g.fillStyle = b.c;
      g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      g.restore();
    }
    if (t < 200 && host.isConnected) requestAnimationFrame(step);
    else c.remove();
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- chests

export function openChest(slot: number, onDone: () => void): void {
  const p = app.profile;
  const type = p.chests[slot];
  if (!type) return;
  p.chests.splice(slot, 1);
  const loot = rollChest(p, type);
  const before = Object.fromEntries(Object.entries(p.cards).map(([k, v]) => [k, v.copies]));
  applyLoot(p, loot);
  save();
  const info = CHEST_INFO[type];
  const stage = h('div', { class: 'chest-open' });
  const steps: (() => Node)[] = [
    () => h('div', null, h('div', { class: 'display stroke', style: 'font-size:26px;text-align:center' }, info.name), img(spriteUrl(info.sprite), 'chest'), h('div', { class: 'tap center' }, 'Tap to open!')),
    () => h('div', { class: 'center' }, img(spriteUrl('ui_gold'), '', 'gold'), h('div', { class: 'count' }, `+${loot.gold}`), h('div', { class: 'muted' }, 'Gold')),
    ...loot.cards.map((c) => () => {
      const pr = p.cards[c.id];
      return h('div', { class: 'center', style: 'display:flex;flex-direction:column;align-items:center;gap:6px' },
        h('div', { class: 'loot' }, cardView(c.id, { level: pr.level })),
        h('div', { class: 'count' }, `x${c.count}`),
        h('div', { class: 'display stroke', style: 'font-size:20px' }, CARDS[c.id].name),
        h('div', { class: 'muted', style: 'font-weight:800;font-size:13px' }, `${before[c.id] ?? 0} → ${pr.copies} copies`),
      );
    }),
  ];
  let i = 0;
  const show = () => {
    stage.innerHTML = '';
    stage.appendChild(steps[i]());
    stage.appendChild(h('div', { class: 'muted center', style: 'font-size:12px;margin-top:6px' }, i < steps.length - 1 ? `${steps.length - 1 - i} left · tap` : 'Tap to finish'));
  };
  const m = modal(stage, {
    closable: false,
  });
  stage.addEventListener('click', () => {
    i++;
    if (i >= steps.length) {
      m.close();
      onDone();
      return;
    }
    sfx(i === 1 ? 'chest' : 'reward');
    show();
  });
  show();
}
