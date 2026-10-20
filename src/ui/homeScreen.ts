import { sfx } from '../audio/sfx';
import { REGIONS, STAGES, stageOpponentName } from '../meta/campaign';
import { CHEST_INFO, CHEST_SLOTS, kingLevel } from '../meta/profile';
import { spriteUrl } from '../render/sprites';
import { app, go, navbar, topbar } from './app';
import { h, img } from './dom';
import { nextStageIndex, openChest, startCampaignStage } from './flows';

export function homeScreen(): HTMLElement {
  const p = app.profile;
  const idx = nextStageIndex();
  const s = STAGES[idx];
  const r = REGIONS[s.region];
  const allClear = STAGES.every((st) => p.cleared[st.index] > 0);

  const bg = h('div', { class: 'home-bg', style: `background-image:url(${spriteUrl('bg_home') ?? ''})` });
  const chests = h('div', { class: 'chests' });
  const renderChests = () => {
    chests.innerHTML = '';
    for (let i = 0; i < CHEST_SLOTS; i++) {
      const t = p.chests[i];
      if (t) {
        chests.appendChild(
          h('button', {
            class: 'chest-slot full',
            title: CHEST_INFO[t].name,
            onclick: () => {
              sfx('chest');
              openChest(i, () => go('home'));
            },
          }, img(spriteUrl(CHEST_INFO[t].sprite)), h('span', { class: 'open display' }, 'OPEN')),
        );
      } else {
        chests.appendChild(h('div', { class: 'chest-slot' }, h('span', { class: 'muted', style: 'font-size:11px;font-weight:800' }, 'Empty')));
      }
    }
  };
  renderChests();

  const battleCard = h('div', { class: 'next-battle panel' },
    img(spriteUrl(r.portrait), 'por'),
    h('div', { class: 'info' },
      h('div', { class: 'rg' }, allClear ? 'Kingdom reclaimed!' : `${r.name} · Stage ${(idx % 4) + 1}/4`),
      h('div', { class: 'sn stroke' }, s.name),
      h('div', { class: 'foe', style: `color:${r.color}` }, s.boss ? `👑 Boss: ${r.warlord} ${r.title}` : `vs ${stageOpponentName(s)} · Lvl ${s.level}`),
    ),
  );

  const content = h('div', { class: 'content' },
    bg,
    h('div', { class: 'home' },
      h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'GROKINGTON'), h('div', { class: 'l2' }, 'CLASH')),
      h('div', { class: 'row', style: 'gap:6px' },
        h('span', { class: 'lvl-badge' }, String(kingLevel(p))),
        h('span', { class: 'display stroke', style: 'font-size:15px' }, 'Commander level'),
      ),
      battleCard,
      h('button', {
        class: 'btn btn-gold btn-big',
        style: 'width:100%',
        onclick: () => {
          sfx('click');
          startCampaignStage(idx);
        },
      }, allClear ? 'REPLAY BOSS' : 'BATTLE!'),
      h('div', { class: 'mode-row' },
        h('button', { class: 'btn btn-purple mode-btn', onclick: () => { sfx('click'); go('gauntlet'); } },
          '🔥 Gauntlet', h('small', null, p.gauntlet.run ? `Run: ${p.gauntlet.run.wins} wins` : `Best: ${p.gauntlet.best} wins`)),
        h('button', { class: 'btn btn-blue mode-btn', onclick: () => { sfx('click'); go('map'); } },
          '🗺️ Campaign', h('small', null, `${Object.keys(p.cleared).length}/${STAGES.length} stages`)),
      ),
      h('div', { class: 'section-title', style: 'margin:4px 0 0;width:100%' }, h('span', { class: 'stroke' }, 'Chests'), h('span', { class: 'muted', style: 'font-size:12px;font-family:var(--body);font-weight:800' }, 'Win battles to earn more')),
      chests,
    ),
  );
  return h('div', { class: 'screen' }, topbar(), content, navbar('home'));
}
