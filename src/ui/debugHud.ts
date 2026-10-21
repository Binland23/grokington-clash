/**
 * Optional on-screen readout of viewport metrics and the last touch events, for diagnosing
 * device-specific layout/input problems (e.g. iOS home-screen apps). Toggled from Settings.
 */
const KEY = 'gc-debug-hud';
let el: HTMLElement | null = null;
let timer = 0;
const events: string[] = [];

export function debugHudEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugHud(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (on) startDebugHud();
  else stopDebugHud();
}

const r = (n: number) => Math.round(n);

function safeInsets(): string {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = `${parseFloat(cs.paddingTop)}/${parseFloat(cs.paddingBottom)}`;
  probe.remove();
  return out;
}

function rect(sel: string): string {
  const e = document.querySelector(sel);
  if (!e) return '-';
  const b = e.getBoundingClientRect();
  return `${r(b.top)}..${r(b.bottom)}`;
}

function render(): void {
  if (!el) return;
  const vv = window.visualViewport;
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  el.textContent = [
    `inner ${innerWidth}x${innerHeight}  vv ${vv ? `${r(vv.width)}x${r(vv.height)} @${r(vv.offsetTop)}` : '-'}`,
    `screen ${screen.width}x${screen.height}  dpr ${devicePixelRatio}  sa ${standalone ? 'y' : 'n'}`,
    `safe t/b ${safeInsets()}  app-h ${getComputedStyle(document.documentElement).getPropertyValue('--app-h')}  gap ${document.documentElement.classList.contains('ios-gap') ? 'y' : 'n'}`,
    `app ${rect('#app')}  arena ${rect('.b-arena')}  hand ${rect('.b-hand')}`,
    ...events,
  ].join('\n');
}

const onPointer = (e: PointerEvent) => {
  const t = e.target as HTMLElement | null;
  const name = t ? `${t.tagName.toLowerCase()}.${String(t.className).split(' ')[0]}` : '?';
  events.unshift(`${e.type.replace('pointer', 'p')} ${e.pointerType[0]} ${r(e.clientX)},${r(e.clientY)} ${name}`);
  events.length = Math.min(events.length, 7);
  render();
};

export function debugNote(msg: string): void {
  if (!el) return;
  events.unshift(`* ${msg}`);
  events.length = Math.min(events.length, 7);
  render();
}

export function startDebugHud(): void {
  if (el) return;
  el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;left:4px;top:calc(env(safe-area-inset-top) + 64px);z-index:9999;margin:0;padding:4px 6px;max-width:96vw;' +
    'font:10px/1.25 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.72);border-radius:6px;pointer-events:none;white-space:pre-wrap';
  document.body.appendChild(el);
  for (const t of ['pointerdown', 'pointerup', 'pointercancel'] as const) window.addEventListener(t, onPointer, true);
  timer = window.setInterval(render, 500);
  render();
}

function stopDebugHud(): void {
  el?.remove();
  el = null;
  clearInterval(timer);
  for (const t of ['pointerdown', 'pointerup', 'pointercancel'] as const) window.removeEventListener(t, onPointer, true);
}
