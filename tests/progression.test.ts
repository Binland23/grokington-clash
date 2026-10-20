import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/engine/cards';
import { STAGES } from '../src/meta/campaign';
import { applyLoot, kingLevel, newProfile, recordCampaignClear, rollChest, unlockCard, upgrade } from '../src/meta/profile';
import { Rng } from '../src/engine/rng';

describe('campaign progression', () => {
  it('counts health-tiebreak wins and grants deck copies only once', () => {
    const p = newProfile();
    expect(recordCampaignClear(p, 0, 0)).toBe(true);
    expect(p.cleared[0]).toBe(1);
    expect(p.deck.every(id => p.cards[id].copies === 2)).toBe(true);
    expect(recordCampaignClear(p, 0, 3)).toBe(false);
    expect(p.cleared[0]).toBe(3);
    expect(p.deck.every(id => p.cards[id].copies === 2)).toBe(true);
  });

  it('unlocks new cards at the current deck level', () => {
    const p = newProfile();
    p.deck.forEach(id => p.cards[id].level = 4);
    expect(unlockCard(p, 'wyrmling')).toBe(true);
    expect(p.cards.wyrmling.level).toBe(4);
    p.cards.wyrmling.copies = 8;
    expect(unlockCard(p, 'wyrmling')).toBe(false);
    expect(p.cards.wyrmling.copies).toBe(8);
  });

  it('supports campaign levels using first clears without replay farming', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = newProfile();
      const rng = new Rng(seed);
      applyLoot(p, rollChest(p, 'wood', () => rng.next()));
      for (const s of STAGES) {
        // Spend on the lowest-level affordable cards first.
        let changed = true;
        while (changed) {
          changed = false;
          for (const id of [...p.deck].sort((a, b) => p.cards[a].level - p.cards[b].level)) {
            if (upgrade(p, id)) { changed = true; break; }
          }
        }
        expect(s.level - kingLevel(p), `stage ${s.index + 1}, seed ${seed}`).toBeLessThanOrEqual(1);
        recordCampaignClear(p, s.index, 1);
        p.gold += s.reward.gold;
        if (s.reward.card) unlockCard(p, s.reward.card);
        applyLoot(p, rollChest(p, s.reward.chest, () => rng.next()));
      }
      expect(kingLevel(p)).toBeGreaterThanOrEqual(5);
    }
  });

  it('provides valid eight-card decks and gradual enemy level steps', () => {
    for (const s of STAGES) {
      expect(new Set(s.deck).size).toBe(8);
      expect(s.deck.every(id => CARDS[id])).toBe(true);
      expect(s.ai.think[0]).toBeGreaterThan(0);
      if (s.index) expect(s.level - STAGES[s.index - 1].level).toBeLessThanOrEqual(1);
    }
  });
});
