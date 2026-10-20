import { describe, expect, it } from 'vitest';
import { AIController, AI_PROFILES, type AIProfile } from '../src/engine/ai';
import { Battle } from '../src/engine/battle';
import { CARD_IDS, STARTER_DECK } from '../src/engine/cards';
import { STAGES } from '../src/meta/campaign';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const levels = (n: number) => Object.fromEntries(CARD_IDS.map(id => [id, n]));
const novice: AIProfile = { think: [2.5, 4], reaction: 2, skill: 0.25, pushMana: 10 };

describe.skipIf(!env.CAMPAIGN_BALANCE)('campaign simulation', () => {
  it('reports all stages with a starter deck and a deliberately slow player', () => {
    const games = Number(env.GAMES ?? 12);
    for (const s of STAGES) {
      let wins = 0, losses = 0, seconds = 0;
      for (let seed = 1; seed <= games; seed++) {
        const lv = 1 + Math.floor(s.index / 4);
        const b = new Battle({
          decks: [STARTER_DECK, s.deck], levels: [levels(lv), levels(s.level)],
          towerLevels: [lv, s.level], powers: ['rally', s.power], seed,
          mods: [{}, { ...s.enemyMods, towerHpMul: s.towerHpMul }],
        });
        const player = new AIController(b, 0, env.PLAYER === 'normal' ? AI_PROFILES.normal : novice, seed * 17);
        const enemy = new AIController(b, 1, s.ai, seed * 31);
        for (let t = 0; t < 301 && b.phase !== 'ended'; t += 1 / 30) {
          player.update(1 / 30); enemy.update(1 / 30); b.update(1 / 30); b.events.length = 0;
        }
        expect(b.result).not.toBeNull();
        if (b.result!.winner === 0) wins++;
        if (b.result!.winner === 1) losses++;
        seconds += b.time;
      }
      console.log(`${s.index + 1} ${s.name}: ${wins}/${games} wins, ${losses} losses, ${Math.round(seconds / games)}s`);
      if (games >= 24 && s.index < 4) expect(wins / games).toBeGreaterThanOrEqual(0.75);
      if (games >= 24 && env.PLAYER === 'normal') expect(wins / games).toBeGreaterThanOrEqual(0.3);
    }
  }, 600_000);
});

it('gives a new player time to deploy before the first enemy action', () => {
  const s = STAGES[0];
  const b = new Battle({
    decks: [STARTER_DECK, s.deck], levels: [levels(1), levels(1)],
    towerLevels: [1, 1], powers: ['rally', null],
    mods: [{}, { ...s.enemyMods, towerHpMul: s.towerHpMul }], seed: 1,
  });
  const ai = new AIController(b, 1, s.ai, 1);
  for (let t = 0; t < 11; t += 1 / 30) {
    ai.update(1 / 30); b.update(1 / 30);
  }
  expect(b.players[1].manaSpent).toBe(0);
  expect(b.players[0].mana).toBeGreaterThan(b.players[1].mana);
});
