import { describe, expect, it } from 'vitest';
import { AIController, AI_PROFILES } from '../src/engine/ai';
import { RIVER_BOTTOM, RIVER_TOP, inWater } from '../src/engine/arena';
import { Battle } from '../src/engine/battle';
import { CARDS, STARTER_DECK, UNITS } from '../src/engine/cards';

const lv = (lvl: number) => Object.fromEntries(Object.keys(CARDS).map((k) => [k, lvl]));

function mkBattle(seed = 7, deck0 = STARTER_DECK, deck1 = STARTER_DECK) {
  return new Battle({ decks: [deck0, deck1], levels: [lv(1), lv(1)], towerLevels: [1, 1], seed, powers: ['rally', 'meteor'] });
}

function step(b: Battle, seconds: number, ai?: AIController[]) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds && b.phase !== 'ended'; t += dt) {
    ai?.forEach((a) => a.update(dt));
    b.update(dt);
  }
}

function handIndexOf(b: Battle, team: 0 | 1, cardId: string): number {
  const p = b.players[team];
  let i = p.hand.indexOf(cardId);
  if (i < 0) {
    // Force the card into hand for deterministic tests.
    p.hand[0] = cardId;
    i = 0;
  }
  return i;
}

describe('placement', () => {
  it('clamps troops to the own half and snaps to tile centres', () => {
    const b = mkBattle();
    const p = b.placement(0, 'knight', 9.2, 5)!;
    expect(p.y).toBeGreaterThanOrEqual(RIVER_BOTTOM + 0.5);
    expect(p.x).toBe(9.5);
    const e = b.placement(1, 'knight', 9.2, 28)!;
    expect(e.y).toBeLessThanOrEqual(RIVER_TOP - 0.5);
  });

  it('rejects drops on top of a tower', () => {
    const b = mkBattle();
    expect(b.placement(0, 'turret', 3.5, 25.5)).toBeNull();
    expect(b.placement(0, 'knight', 9, 29)).toBeNull();
  });

  it('lets spells land anywhere', () => {
    const b = mkBattle();
    expect(b.placement(0, 'fireorb', 3.5, 6.5)).toEqual({ x: 3.5, y: 6.5 });
  });

  it('opens the pocket after a watchtower falls', () => {
    const b = mkBattle();
    const w = b.tower(1, 'watch', -1)!;
    b.damage(w, 1e6, 0);
    expect(b.placement(0, 'knight', 3, 12)!.y).toBeLessThan(RIVER_TOP);
    // Other lane stays closed.
    expect(b.placement(0, 'knight', 15, 12)!.y).toBeGreaterThan(RIVER_BOTTOM);
  });
});

describe('mana and cycling', () => {
  it('spends mana and cycles the played card to the back', () => {
    const b = mkBattle();
    const p = b.players[0];
    const i = handIndexOf(b, 0, 'knight');
    const nextBefore = p.queue[0];
    p.mana = 5;
    expect(b.deploy(0, i, 9, 24)).toBe(true);
    expect(p.mana).toBeCloseTo(2);
    expect(p.hand[i]).toBe(nextBefore);
    expect(p.queue[p.queue.length - 1]).toBe('knight');
  });

  it('refuses cards it cannot afford', () => {
    const b = mkBattle();
    const i = handIndexOf(b, 0, 'brute');
    b.players[0].mana = 2;
    expect(b.deploy(0, i, 9, 24)).toBe(false);
  });

  it('regenerates and caps at 10', () => {
    const b = mkBattle();
    b.players[0].mana = 0;
    step(b, 2.8);
    expect(b.players[0].mana).toBeGreaterThan(0.9);
    step(b, 60);
    expect(b.players[0].mana).toBe(10);
  });
});

describe('combat', () => {
  it('a lone troop crosses a bridge, never swims, and takes a watchtower', () => {
    const b = mkBattle();
    b.players[1].mana = 0;
    const knight = b.spawnUnit(0, { ...UNITS.knight, hp: 99999 }, 1, 3.5, 20);
    const tower = b.tower(1, 'watch', -1)!;
    let swam = false;
    const dt = 1 / 30;
    for (let t = 0; t < 120 && !tower.dead; t += dt) {
      b.update(dt);
      if (inWater(knight.x, knight.y)) swam = true;
    }
    expect(swam).toBe(false);
    expect(tower.dead).toBe(true);
    expect(b.players[0].crowns).toBe(1);
    // Keep wakes up once a watchtower falls.
    expect(b.tower(1, 'keep')!.active).toBe(true);
  });

  it('a troop dropped directly behind its own tower walks around it', () => {
    for (const [x, team] of [[3.5, 0], [14.5, 0], [3.5, 1]] as const) {
      const b = mkBattle();
      b.players[0].mana = 0;
      b.players[1].mana = 0;
      const y = team === 0 ? 28.0 : 32 - 28.0;
      const k = b.spawnUnit(team, { ...UNITS.knight, hp: 99999 }, 1, x, y, 0);
      step(b, 8);
      // It must have got past its own watchtower toward the river.
      if (team === 0) expect(k.y).toBeLessThan(23);
      else expect(k.y).toBeGreaterThan(9);
    }
  });

  it('a slow tank behind the tower also gets around it', () => {
    const b = mkBattle();
    const brute = b.spawnUnit(0, { ...UNITS.brute, hp: 99999 }, 1, 3.5, 28.5, 0);
    step(b, 12);
    expect(brute.y).toBeLessThan(23.5);
  });

  it('building-hunters ignore troops', () => {
    const b = mkBattle();
    const brute = b.spawnUnit(0, UNITS.brute, 1, 3.5, 19, 0);
    b.spawnUnit(1, UNITS.knight, 1, 3.5, 17.5, 0);
    step(b, 0.5);
    expect(brute.target?.isStructure).toBe(true);
  });

  it('spells deal reduced damage to towers', () => {
    const b = mkBattle();
    const w = b.tower(1, 'watch', -1)!;
    const before = w.hp;
    b.castSpell(0, CARDS.spark, w.x, w.y, 1);
    expect(before - w.hp).toBeCloseTo((CARDS.spark.spell!.damage ?? 0) * 0.35, 0);
  });

  it('destroying the keep wins with three crowns', () => {
    const b = mkBattle();
    b.damage(b.tower(1, 'keep')!, 1e7, 0);
    expect(b.phase).toBe('ended');
    expect(b.result?.winner).toBe(0);
    expect(b.result?.crowns[0]).toBe(3);
  });

  it('flying units are only hit by air-capable attackers', () => {
    const b = mkBattle();
    const g = b.spawnUnit(1, UNITS.gargoyle, 1, 9, 22, 0);
    const k = b.spawnUnit(0, UNITS.knight, 1, 9, 23, 0);
    expect(b.canTarget(k, g)).toBe(false);
    const a = b.spawnUnit(0, UNITS.archer, 1, 9, 24, 0);
    expect(b.canTarget(a, g)).toBe(true);
  });
});

describe('time limits', () => {
  it('goes to overtime on equal crowns and then breaks ties on tower health', () => {
    const b = new Battle({ decks: [STARTER_DECK, STARTER_DECK], levels: [lv(1), lv(1)], towerLevels: [1, 1], seed: 3, regulation: 2, overtime: 2 });
    step(b, 2.1);
    expect(b.phase).toBe('overtime');
    b.tower(1, 'watch', 1)!.hp -= 10;
    step(b, 2.1);
    expect(b.phase).toBe('ended');
    expect(b.result?.winner).toBe(0);
  });
});

describe('AI', () => {
  it('two AIs play a full match to a result without errors', () => {
    for (const seed of [1, 2, 3]) {
      const decks = [
        ['knight', 'archers', 'imps', 'brute', 'gunner', 'turret', 'fireorb', 'arrows'],
        ['boarrider', 'wyrmling', 'boneswarm', 'pyromancer', 'berserker', 'spark', 'frost', 'imphut'],
      ];
      const b = new Battle({ decks: [decks[0], decks[1]], levels: [lv(3), lv(3)], towerLevels: [3, 3], seed, powers: ['thunder', 'imphorde'] });
      const ais = [new AIController(b, 0, AI_PROFILES.hard, seed), new AIController(b, 1, AI_PROFILES.normal, seed + 9)];
      let deployed = 0;
      const dt = 1 / 30;
      for (let t = 0; t < 300 && b.phase !== 'ended'; t += dt) {
        ais.forEach((a) => a.update(dt));
        b.update(dt);
        deployed += b.events.filter((e) => e.type === 'deploy').length;
        b.events.length = 0;
      }
      expect(b.phase).toBe('ended');
      expect(deployed).toBeGreaterThan(10);
      expect(b.result).not.toBeNull();
    }
  });
});
