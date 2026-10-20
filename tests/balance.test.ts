import { describe, it } from 'vitest';
import { AIController, AI_PROFILES } from '../src/engine/ai';
import { Battle } from '../src/engine/battle';
import { CARDS, CARD_IDS } from '../src/engine/cards';
import { Rng } from '../src/engine/rng';

// Balance report: BALANCE=1 npx vitest run tests/balance.test.ts
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const RUN = !!env.BALANCE;

describe.skipIf(!RUN)('balance', () => {
  it('reports per-card win rates over many AI-vs-AI matches', () => {
    const rng = new Rng(42);
    const games = Number(env.GAMES ?? 300);
    const stats: Record<string, { w: number; n: number }> = {};
    for (const id of CARD_IDS) stats[id] = { w: 0, n: 0 };
    const lv = Object.fromEntries(CARD_IDS.map((k) => [k, 5]));
    let draws = 0;
    let totalTime = 0;
    for (let g = 0; g < games; g++) {
      const decks: [string[], string[]] = [rng.shuffle(CARD_IDS.slice()).slice(0, 8), rng.shuffle(CARD_IDS.slice()).slice(0, 8)];
      const b = new Battle({ decks, levels: [lv, lv], towerLevels: [5, 5], seed: g + 1, powers: ['rally', 'rally'] });
      const ais = [new AIController(b, 0, AI_PROFILES.hard, g * 7 + 1), new AIController(b, 1, AI_PROFILES.hard, g * 13 + 5)];
      const dt = 1 / 30;
      for (let t = 0; t < 300 && b.phase !== 'ended'; t += dt) {
        ais[0].update(dt);
        ais[1].update(dt);
        b.update(dt);
        b.events.length = 0;
      }
      const w = b.result?.winner ?? null;
      totalTime += b.time;
      if (w === null) draws++;
      decks.forEach((d, team) => {
        for (const id of d) {
          stats[id].n++;
          if (w === team) stats[id].w++;
        }
      });
    }
    const rows = Object.entries(stats)
      .map(([id, s]) => ({ id, name: CARDS[id].name, cost: CARDS[id].cost, rate: s.n ? s.w / s.n : 0, n: s.n }))
      .sort((a, b) => b.rate - a.rate);
    console.log(`\n${games} games, ${draws} draws, avg length ${(totalTime / games).toFixed(0)}s`);
    for (const r of rows) console.log(`${(r.rate * 100).toFixed(1).padStart(5)}%  ${r.name.padEnd(14)} cost ${r.cost}  (${r.n})`);
  }, 600_000);
});
