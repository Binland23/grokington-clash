import '@fontsource/lilita-one/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import { unlockAudio } from './audio/sfx';
import { loadSprites } from './render/sprites';
import { loadModels } from './render3d/models';
import { app, go, initApp, registerScreen } from './ui/app';
import { battleScreen } from './ui/battleScreen';
import { loadingScreen } from './ui/loadingScreen';
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
  const ls = loadingScreen();
  const loading = ls.el;
  root.appendChild(loading);
  let fs = 0;
  let fm = 0;
  const prog = () => ls.setProgress(fs * 0.4 + fm * 0.6);
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
  ls.setProgress(1);
  ls.showTap();
  const start = () => {
    unlockAudio();
    ls.destroy();
    const params = new URLSearchParams(location.search);
    if (params.has('quick')) {
      startCampaignStage(Number(params.get('quick')) || 0);
    } else go('home');
  };
  loading.addEventListener('pointerup', start, { once: true });
  void app;
}

// iOS home-screen apps can resume with a stale or scrolled viewport; re-pin and re-measure.
const fitViewport = () => {
  // Trust the viewport the browser actually shows. (Forcing screen.height made the app taller than the visible area.)
  const hgt = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-h', `${Math.round(hgt)}px`);
};
fitViewport();
window.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('resize', fitViewport);
const refit = () => {
  fitViewport();
  window.scrollTo(0, 0);
  for (const d of [0, 120, 400]) setTimeout(() => window.dispatchEvent(new Event('resize')), d);
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refit();
});
window.addEventListener('pageshow', refit);
window.addEventListener('orientationchange', refit);

void boot();
