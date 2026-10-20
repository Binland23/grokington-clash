import { sfx } from '../audio/sfx';
import { CARDS } from '../engine/cards';
import { POWERS } from '../engine/powers';
import { REGIONS, STAGES, stageOpponentName, type Stage } from '../meta/campaign';
import { CHEST_INFO } from '../meta/profile';
import { spriteUrl } from '../render/sprites';
import { app, modal, navbar, topbar } from './app';
import { h, img } from './dom';
import { nextStageIndex, stageUnlocked, startCampaignStage } from './flows';
import { cardView } from './widgets';

/** Height of one region band on the map, in px. */
const BAND = 330;
/** Node layout inside a band: x %, y fraction from the band top (bottom to top order). */
const SLOTS = [
  { x: 30, y: 0.8 },
  { x: 68, y: 0.6 },
  { x: 34, y: 0.4 },
  { x: 62, y: 0.17 },
];

export function mapScreen(): HTMLElement {
  const p = app.profile;
  const current = nextStageIndex();
  const total = BAND * REGIONS.length;
  const bgSrc = spriteUrl('bg_map');
  // The painted world map spans the whole scroll height (cropped at the sides).
  const map = h('div', {
    class: 'map',
    style: `height:${total}px;background:${bgSrc ? `url(${bgSrc}) center / auto 100% no-repeat` : '#2a5a2a'}`,
  });
  // Region bands, bottom (first region) to top (last).
  REGIONS.forEach((r, ri) => {
    const top = total - (ri + 1) * BAND;
    map.appendChild(
      h('div', { class: 'map-band', style: `top:${top}px;height:${BAND}px` },
        h('div', { class: 'band-title', style: `color:${r.color}` }, h('span', null, r.name), h('small', null, `${r.warlord} ${r.title}`))),
    );
  });
  const pos = (s: Stage) => {
    const slot = SLOTS[s.index % 4];
    const top = total - (s.region + 1) * BAND;
    return { x: slot.x, y: top + slot.y * BAND };
  };

  // Road between nodes (px coordinates, x in % of width -> use a 100-wide viewBox).
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'road');
  svg.setAttribute('viewBox', `0 0 100 ${total}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  for (let i = 0; i < STAGES.length - 1; i++) {
    const a = pos(STAGES[i]);
    const b = pos(STAGES[i + 1]);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
    line.setAttribute('stroke', p.cleared[i] > 0 ? '#ffd23f' : 'rgba(255,255,255,0.7)');
    line.setAttribute('stroke-dasharray', '10 8');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.style.strokeWidth = '5px';
    svg.appendChild(line);
  }
  map.appendChild(svg);

  let currentEl: HTMLElement | null = null;
  for (const s of STAGES) {
    const unlocked = stageUnlocked(s.index);
    const crowns = p.cleared[s.index] ?? 0;
    const at = pos(s);
    const cls = ['node', s.boss ? 'boss' : '', unlocked ? '' : 'locked', s.index === current && unlocked ? 'current' : ''].join(' ');
    const node = h('button', {
      class: cls,
      style: `left:${at.x}%;top:${at.y}px`,
      onclick: () => {
        sfx('click');
        stageModal(s, unlocked);
      },
    },
      s.boss ? img(spriteUrl(REGIONS[s.region].portrait)) : String((s.index % 4) + 1),
      crowns > 0 ? h('span', { class: 'stars' }, '👑'.repeat(crowns)) : null,
    );
    if (s.index === current) currentEl = node;
    map.appendChild(node);
  }

  const content = h('div', { class: 'content' }, map);
  const root = h('div', { class: 'screen' }, topbar(), content, navbar('map'));
  // Scroll so the current stage is in view.
  requestAnimationFrame(() => {
    if (currentEl) {
      const r = currentEl.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      content.scrollTop += r.top - c.top - c.height / 2;
    } else content.scrollTop = content.scrollHeight;
  });
  return root;
}

function stageModal(s: Stage, unlocked: boolean): void {
  const p = app.profile;
  const r = REGIONS[s.region];
  const cleared = p.cleared[s.index] > 0;
  const rewards: Node[] = [];
  if (!cleared) {
    rewards.push(h('div', { class: 'reward panel' }, '🃏', '+2 copies of every deck card'));
    rewards.push(h('div', { class: 'reward panel' }, img(spriteUrl('ui_gold')), `${s.reward.gold}`));
    rewards.push(h('div', { class: 'reward panel' }, img(spriteUrl(CHEST_INFO[s.reward.chest].sprite)), CHEST_INFO[s.reward.chest].name));
    if (s.reward.card) rewards.push(h('div', { class: 'reward panel' }, h('div', { style: 'width:56px;margin:0 auto 4px;container-type:inline-size' }, cardView(s.reward.card)), CARDS[s.reward.card].name));
    if (s.reward.power) rewards.push(h('div', { class: 'reward panel' }, h('div', { class: 'big-ico' }, POWERS[s.reward.power].icon), POWERS[s.reward.power].name));
  } else {
    rewards.push(h('div', { class: 'reward panel' }, img(spriteUrl('ui_gold')), `${Math.round(s.reward.gold * 0.35)}`));
  }
  const m = modal(
    h('div', null,
      h('div', { class: 'row' },
        img(spriteUrl(r.portrait), 'avatar', ''),
        h('div', null,
          h('div', { class: 'muted', style: 'font-size:12px;font-weight:800;text-transform:uppercase' }, `${r.name} · Stage ${(s.index % 4) + 1}`),
          h('div', { class: 'display stroke', style: 'font-size:22px' }, s.name),
        ),
      ),
      h('p', { style: 'font-weight:700;margin:10px 0' },
        s.boss ? `${r.warlord} ${r.title} awaits, wielding ${POWERS[r.power].name}.` : `Face the ${stageOpponentName(s)} (level ${s.level}).`),
      h('div', { class: 'muted', style: 'font-size:12px;font-weight:800;margin-bottom:4px' }, 'ENEMY DECK'),
      h('div', { style: 'display:grid;grid-template-columns:repeat(8,1fr);gap:3px' },
        ...s.deck.map((id) => h('div', { style: 'container-type:inline-size' }, cardView(id, { cost: false })))),
      h('div', { class: 'muted', style: 'font-size:12px;font-weight:800;margin:12px 0 4px' }, cleared ? `CLEARED · BEST ${'👑'.repeat(p.cleared[s.index])}` : 'FIRST CLEAR REWARDS'),
      h('div', { class: 'reward-list' }, ...rewards),
      h('div', { class: 'center', style: 'margin-top:14px' },
        unlocked
          ? h('button', { class: 'btn btn-gold btn-big', onclick: () => { sfx('click'); m.close(); startCampaignStage(s.index); } }, cleared ? 'Replay' : 'Fight!')
          : h('div', { class: 'display muted' }, '🔒 Clear the previous stage first'),
      ),
    ),
  );
}
