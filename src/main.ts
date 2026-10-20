import '@fontsource/lilita-one/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import { unlockAudio } from './audio/sfx';
import { loadSprites } from './render/sprites';
import { loadModels } from './render3d/models';
import { app, go, initApp, registerScreen } from './ui/app';
import { battleScreen } from './ui/battleScreen';
import { h } from './ui/dom';
import { cardsScreen } from './ui/cardsScreen';
import { gauntletScreen } from './ui/gauntletScreen';
import { homeScreen } from './ui/homeScreen';
import { mapScreen } from './ui/mapScreen';
import { startCampaignStage } from './ui/flows';

const root = document.getElementById('app')!;
initApp(root);
registerScreen('home', homeScreen);
registerScreen('map', mapScreen);
registerScreen('cards', cardsScreen);
registerScreen('gauntlet', gauntletScreen);
registerScreen('battle', battleScreen);

// Block pinch-zoom / double-tap zoom on iOS.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

async function boot() {
  const fill = h('i');
  const status = h('div', { class: 'muted', style: 'font-weight:800' }, 'Summoning warriors...');
  const loading = h('div', { class: 'loading' },
    h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'GROKINGTON'), h('div', { class: 'l2' }, 'CLASH')),
    h('div', { class: 'bar' }, fill),
    status,
  );
  root.appendChild(loading);
  let fs = 0;
  let fm = 0;
  const prog = () => (fill.style.width = `${Math.round((fs * 0.4 + fm * 0.6) * 100)}%`);
  await Promise.all([
    loadSprites((f) => {
      fs = f;
      prog();
    }),
    loadModels((f) => {
      fm = f;
      prog();
    }),
    document.fonts?.load('20px "Lilita One"').catch(() => undefined),
  ]);
  fill.style.width = '100%';
  status.replaceWith(h('div', { class: 'tap' }, 'Tap to play'));
  const start = () => {
    unlockAudio();
    loading.remove();
    const params = new URLSearchParams(location.search);
    if (params.has('quick')) {
      startCampaignStage(Number(params.get('quick')) || 0);
    } else go('home');
  };
  loading.addEventListener('pointerup', start, { once: true });
  void app;
}

void boot();
