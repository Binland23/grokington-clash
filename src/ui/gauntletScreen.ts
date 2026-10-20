import { sfx } from '../audio/sfx';
import { POWERS } from '../engine/powers';
import { BOONS } from '../meta/profile';
import { app, confirmModal, go, navbar, save, topbar } from './app';
import { h } from './dom';
import { startGauntletBattle, startGauntletRun } from './flows';
import { cardView } from './widgets';

export function gauntletScreen(): HTMLElement {
  const p = app.profile;
  const run = p.gauntlet.run;
  const body = h('div', { style: 'padding:14px;display:flex;flex-direction:column;gap:14px' });

  body.appendChild(
    h('div', { class: 'panel', style: 'padding:14px' },
      h('div', { class: 'display stroke', style: 'font-size:28px;text-align:center' }, '🔥 The Gauntlet'),
      h('p', { style: 'font-weight:700;text-align:center;margin:6px 0' },
        'Fight an endless chain of warlord armies. After every victory choose a boon that powers up your army. One defeat ends the run.'),
      h('div', { class: 'row', style: 'justify-content:center;gap:18px' },
        h('div', { class: 'center' }, h('div', { class: 'display', style: 'font-size:30px;color:var(--gold)' }, String(p.gauntlet.best)), h('div', { class: 'muted', style: 'font-weight:800;font-size:12px' }, 'BEST RUN')),
        run ? h('div', { class: 'center' }, h('div', { class: 'display', style: 'font-size:30px' }, String(run.wins)), h('div', { class: 'muted', style: 'font-weight:800;font-size:12px' }, 'CURRENT')) : null,
      ),
    ),
  );

  if (run?.offer) {
    const offer = run.offer;
    body.appendChild(h('div', { class: 'display stroke', style: 'font-size:22px;text-align:center' }, 'Choose a boon'));
    body.appendChild(
      h('div', { class: 'boon-list' },
        ...offer.map((id) => {
          const b = BOONS.find((x) => x.id === id)!;
          return h('button', {
            class: 'boon panel',
            onclick: () => {
              sfx('reward');
              run.boons.push(id);
              run.offer = null;
              save();
              go('gauntlet');
            },
          }, h('span', { class: 'ico' }, b.icon), h('div', null, h('b', null, b.name), h('span', null, b.desc)));
        }),
      ),
    );
  } else if (run) {
    const counts: Record<string, number> = {};
    for (const id of run.boons) counts[id] = (counts[id] ?? 0) + 1;
    body.appendChild(
      h('div', { class: 'panel', style: 'padding:12px' },
        h('div', { class: 'muted', style: 'font-weight:800;font-size:12px;margin-bottom:6px' }, 'YOUR BOONS'),
        run.boons.length
          ? h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
              ...Object.entries(counts).map(([id, n]) => {
                const b = BOONS.find((x) => x.id === id)!;
                return h('span', { class: 'currency', style: 'font-size:14px;padding:4px 10px' }, `${b.icon} ${b.name}${n > 1 ? ` x${n}` : ''}`);
              }))
          : h('div', { style: 'font-weight:700' }, 'None yet — win a battle to earn one.'),
        h('div', { class: 'muted', style: 'font-weight:800;font-size:12px;margin:10px 0 6px' }, `RUN DECK · ${POWERS[run.power]?.icon ?? ''} ${POWERS[run.power]?.name ?? ''}`),
        h('div', { style: 'display:grid;grid-template-columns:repeat(8,1fr);gap:3px' },
          ...run.deck.map((id) => h('div', { style: 'container-type:inline-size' }, cardView(id, { cost: false })))),
      ),
    );
    body.appendChild(
      h('button', { class: 'btn btn-gold btn-big', onclick: () => { sfx('click'); startGauntletBattle(); } }, `Battle ${run.wins + 1}`),
    );
    body.appendChild(
      h('button', {
        class: 'btn btn-red btn-sm',
        style: 'align-self:center',
        onclick: () =>
          confirmModal('Abandon run?', 'Your current streak will end.', 'Abandon', () => {
            p.gauntlet.best = Math.max(p.gauntlet.best, run.wins);
            p.gauntlet.run = null;
            save();
            go('gauntlet');
          }, true),
      }, 'Abandon run'),
    );
  } else {
    body.appendChild(
      h('div', { class: 'panel', style: 'padding:12px' },
        h('div', { class: 'muted', style: 'font-weight:800;font-size:12px;margin-bottom:6px' }, 'REWARDS'),
        h('div', { style: 'font-weight:700;font-size:14px;line-height:1.5' },
          '• Gold after every win (more the longer you last)', h('br'),
          '• Silver chest at 3 wins, Golden at 6, Royal at 10', h('br'),
          '• A warlord boss every 5th battle'),
      ),
    );
    body.appendChild(
      h('button', { class: 'btn btn-gold btn-big', onclick: () => { sfx('click'); startGauntletRun(); } }, 'Start run'),
    );
    body.appendChild(h('p', { class: 'center muted', style: 'font-weight:700;font-size:13px' }, 'Your current deck and commander power are locked in for the run.'));
  }

  return h('div', { class: 'screen' }, topbar(), h('div', { class: 'content' }, body), navbar('gauntlet'));
}
