import { sfx } from '../audio/sfx';
import { CARDS, CARD_IDS, MAX_LEVEL, UNITS } from '../engine/cards';
import { hasModel } from '../render3d/models';
import { mountViewer } from '../render3d/viewer';
import { POWERS, POWER_IDS } from '../engine/powers';
import { REGIONS, STAGES } from '../meta/campaign';
import { canUpgrade, upgrade, upgradeCost } from '../meta/profile';
import { spriteUrl } from '../render/sprites';
import { app, go, modal, navbar, save, toast, topbar } from './app';
import { fmt, h, img } from './dom';
import { cardStats, cardView } from './widgets';

let swapCard: string | null = null;

export function cardsScreen(): HTMLElement {
  const p = app.profile;
  const deckGrid = h('div', { class: `deck-grid ${swapCard ? 'swapping' : ''}` });
  for (const id of p.deck) {
    const pr = p.cards[id];
    deckGrid.appendChild(
      h('button', {
        class: 'slot',
        onclick: () => {
          sfx('click');
          if (swapCard) {
            const i = p.deck.indexOf(id);
            p.deck[i] = swapCard;
            swapCard = null;
            save();
            go('cards');
          } else cardModal(id);
        },
      }, cardView(id, { level: pr.level, upgradable: canUpgrade(p, id) }), copiesBar(id)),
    );
  }
  const avg = p.deck.reduce((s, id) => s + CARDS[id].cost, 0) / p.deck.length;

  const powers = h('div', { class: 'power-row' },
    ...POWER_IDS.map((pid) => {
      const def = POWERS[pid];
      const owned = p.powers.includes(pid);
      return h('button', {
        class: `power-chip ${p.power === pid ? 'on' : ''} ${owned ? '' : 'locked'}`,
        onclick: () => {
          sfx('click');
          if (!owned) {
            const region = REGIONS.find((r) => r.power === pid);
            toast(region ? `Defeat ${region.warlord} to unlock` : 'Locked');
            return;
          }
          powerModal(pid);
        },
      }, h('span', { class: 'ico' }, owned ? def.icon : '🔒'), h('span', { class: 'display' }, def.name));
    }),
  );

  const owned = CARD_IDS.filter((id) => p.cards[id] && !p.deck.includes(id));
  const locked = CARD_IDS.filter((id) => !p.cards[id]);
  const coll = h('div', { class: 'coll-grid' },
    ...owned.map((id) =>
      h('button', { class: 'slot', onclick: () => { sfx('click'); cardModal(id); } },
        cardView(id, { level: p.cards[id].level, upgradable: canUpgrade(p, id) }), copiesBar(id)),
    ),
    ...locked.map((id) =>
      h('button', {
        class: 'slot',
        onclick: () => {
          const st = STAGES.find((s) => s.reward.card === id);
          toast(st ? `Unlocks at ${st.name} (${REGIONS[st.region].name})` : 'Locked');
        },
      }, cardView(id, { locked: true })),
    ),
  );

  const content = h('div', { class: 'content' },
    swapCard
      ? h('div', { class: 'section-title' },
          h('span', { class: 'stroke' }, `Tap a card to replace with ${CARDS[swapCard].name}`),
          h('button', { class: 'btn btn-red btn-sm', onclick: () => { swapCard = null; go('cards'); } }, 'Cancel'))
      : h('div', { class: 'section-title' }, h('span', { class: 'stroke' }, 'Battle Deck'), h('span', { class: 'muted', style: 'font-size:13px;font-family:var(--body);font-weight:800' }, `Avg cost ${avg.toFixed(1)}`)),
    deckGrid,
    h('div', { class: 'section-title' }, h('span', { class: 'stroke' }, 'Commander Power')),
    powers,
    h('div', { class: 'section-title' }, h('span', { class: 'stroke' }, 'Collection'), h('span', { class: 'muted', style: 'font-size:13px;font-family:var(--body);font-weight:800' }, `Found ${Object.keys(p.cards).length}/${CARD_IDS.length}`)),
    coll,
    h('div', { style: 'height:20px' }),
  );
  return h('div', { class: 'screen' }, topbar(), content, navbar('cards'));
}

function copiesBar(id: string): HTMLElement {
  const p = app.profile;
  const pr = p.cards[id];
  const cost = upgradeCost(p, id);
  if (!cost) return h('div', { class: 'copies-bar full' }, h('i', { style: 'width:100%' }), h('span', null, 'MAX'));
  const f = Math.min(1, pr.copies / cost.copies);
  return h('div', { class: `copies-bar ${f >= 1 ? 'full' : ''}` }, h('i', { style: `width:${f * 100}%` }), h('span', null, `${pr.copies}/${cost.copies}`));
}

function cardModal(id: string): void {
  const p = app.profile;
  const c = CARDS[id];
  const pr = p.cards[id];
  const cost = upgradeCost(p, id);
  const inDeck = p.deck.includes(id);
  const stats = cardStats(id, pr.level);
  const can = canUpgrade(p, id);
  const unit = c.unit ? UNITS[c.unit] : null;
  const show3d = !!unit && hasModel(unit.id === 'sentinel' ? 'brute' : unit.id);
  const stage = show3d ? h('div', { class: 'viewer3d' }) : null;
  let unmount: (() => void) | null = null;
  const m = modal(
    h('div', null,
      stage,
      h('div', { class: 'row', style: 'align-items:flex-start' },
        h('div', { style: 'width:110px;flex:none;container-type:inline-size' }, cardView(id, { level: pr.level })),
        h('div', { style: 'flex:1' },
          h('div', { class: 'display stroke', style: 'font-size:24px;line-height:1' }, c.name),
          h('div', { style: `font-weight:800;font-size:12px;text-transform:uppercase;color:var(--${c.rarity})` }, `${c.rarity} ${c.type}`),
          h('p', { style: 'font-weight:700;font-size:14px;margin:6px 0' }, c.desc),
          copiesBar(id),
        ),
      ),
      h('div', { class: 'stat-table' },
        ...stats.map((s) => h('div', { class: 'stat' }, h('div', { class: 'k' }, s.k), h('div', { class: 'v' }, s.v, s.next && cost ? h('span', { class: 'up' }, ` ${s.next}`) : null))),
      ),
      h('div', { class: 'row', style: 'justify-content:center;flex-wrap:wrap' },
        cost
          ? h('button', {
              class: `btn ${can ? 'btn-green' : 'btn-gray'}`,
              disabled: !can,
              onclick: () => {
                if (upgrade(p, id)) {
                  sfx('reward');
                  sfx('crown');
                  save();
                  m.close();
                  toast(`${c.name} is now level ${p.cards[id].level}!`);
                  go('cards');
                }
              },
            }, h('div', null, 'Upgrade'), h('div', { style: 'display:flex;align-items:center;gap:3px;justify-content:center;font-size:14px' }, img(spriteUrl('ui_gold'), '', ''), fmt(cost.gold)))
          : h('div', { class: 'display', style: 'color:var(--gold)' }, `Max level (${MAX_LEVEL})`),
        !inDeck
          ? h('button', {
              class: 'btn btn-blue',
              onclick: () => {
                sfx('click');
                swapCard = id;
                m.close();
                go('cards');
              },
            }, 'Use in deck')
          : null,
      ),
      cost && !can ? h('p', { class: 'center muted', style: 'font-size:12px;font-weight:800' }, pr.copies < cost.copies ? `Need ${cost.copies - pr.copies} more copies (from chests).` : `Need ${fmt(cost.gold - p.gold)} more gold.`) : null,
    ),
  );
  // Gold icon inside the button.
  m.el.querySelectorAll('.btn img').forEach((el) => ((el as HTMLElement).style.cssText = 'width:20px;height:20px;object-fit:contain'));
  if (stage && unit) {
    unmount = mountViewer(stage, unit);
    const obs = new MutationObserver(() => {
      if (!m.el.isConnected) {
        unmount?.();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
}

function powerModal(pid: string): void {
  const p = app.profile;
  const def = POWERS[pid];
  const m = modal(
    h('div', { class: 'center' },
      h('div', { style: 'font-size:64px' }, def.icon),
      h('h2', { class: 'stroke' }, def.name),
      h('p', { style: 'font-weight:700' }, def.desc),
      h('p', { class: 'muted', style: 'font-weight:800;font-size:13px' }, `Charges in ${def.chargeTime}s · ${def.targeting === 'none' ? 'Instant' : def.targeting === 'own' ? 'Target your side' : 'Target anywhere'}`),
      p.power === pid
        ? h('div', { class: 'display', style: 'color:var(--gold)' }, 'Equipped')
        : h('button', {
            class: 'btn btn-gold',
            onclick: () => {
              p.power = pid;
              save();
              sfx('reward');
              m.close();
              go('cards');
            },
          }, 'Equip'),
    ),
  );
}
