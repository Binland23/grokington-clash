# Grokington Clash — Design

Single-player, mobile-first (portrait) real-time lane battler inspired by Clash Royale,
with a campaign against AI warlords instead of online matchmaking.

## What the user asked for (stated)
- A Clash Royale-style game, ground-up build, with its own creative spin.
- Single player (no multiplayer).
- Mobile-facing and laid out like Clash Royale; played on a phone, developed on a PC first.
- Detailed art (characters etc.) is generated with the Grok CLI from the terminal.

## Assumptions (my calls; easy to change)
- Built as a web game (TypeScript + Vite + Canvas 2D). It runs in any phone browser, can be
  added to the home screen as a full-screen web app (PWA manifest), and can later be wrapped
  natively (Capacitor) without a rewrite. The phone loads it over Wi-Fi from the dev PC.
- No monetization, no timers, no gems: chests open instantly. Progress is saved locally.
- Working title "Grokington Clash"; setting is the Kingdom of Grokington.

## Success criteria
- A full battle is playable on a phone with touch: drag/tap cards to deploy, units fight,
  towers fall, crowns and a winner are decided, at 60 fps on a modern phone.
- An AI opponent that defends and attacks sensibly, with difficulty that scales.
- A campaign with progression (new cards, card levels, gold, chests) that gives reasons to keep playing.
- Art: Grok-generated sprites with a procedural fallback so the game never breaks on a missing asset.

## Core battle (CR-faithful)
- Arena 18 x 32 tiles, portrait. Player at the bottom, enemy at the top, river in the middle
  (y 15–17) with two bridges (x = 3.5 and 14.5).
- Each side: a Keep (king tower, 3 crowns) and two Watchtowers (1 crown each). The Keep wakes
  when it is hit or a Watchtower falls.
- Mana: starts at 5, max 10, +1 every 2.8 s (double in the last 60 s and in overtime).
- Deck of 8 cards; hand of 4 plus a "next" preview; cards cycle.
- Deploy on your own half; destroying an enemy Watchtower opens that lane's pocket.
- 3:00 regulation + 1:00 sudden-death overtime; then lowest-tower-HP tiebreak, then draw.
- Unit model: HP, damage, hit speed, first-hit delay, range, sight, speed, size, ground/air,
  targets (ground / air+ground / buildings), splash, death effects, charge, spawners, lifetime.

## The single-player spin
1. **Warlord Campaign** — Grokington is split among six warlords. Six regions, each with three
   battles and a boss: Grubnok the Goblin King (swamp), Ysolde the Frost Witch (peaks),
   the Iron Baron (forge city), Pyra the Ember Queen (volcano), Captain Squall (sky isles),
   and the Hollow King (necropolis). Each enemy has a themed deck and a level that rises along the road.
2. **Commander Powers** — both sides have a power meter that fills over time. Tap it to
   unleash a power (Rally Horn, Thunderstrike, Frost Breath, Meteor, Reinforcements...).
   Beating a warlord unlocks their power for you. Bosses use their own power against you.
3. **Gauntlet** (endless) — a run of escalating battles; after each win pick 1 of 3 boons
   (e.g. +15% troop HP, start with 7 mana, faster mana). One loss ends the run. Best run saved.
4. **Progression without paywalls** — wins give gold and chests (open instantly); chests give
   card copies; copies + gold level cards up (1–10, +10% stats per level). First clears unlock new cards.

## Cards (22)
Troops: Knight, Archer Duo, Imp Gang, Boulder Brute, Ironclad, Dwarf Gunner, Wyrmling,
Bone Swarm, Boar Rider, Pyromancer, Berserker, Gargoyles, Bomb Blimp, Lancer.
Buildings: Bolt Turret, Imp Hut. Spells: Fire Orb, Arrow Volley, Spark, War Drums, Frost Nova, Mending Light.
Starter deck: Knight, Archer Duo, Imp Gang, Boulder Brute, Dwarf Gunner, Bolt Turret, Fire Orb, Arrow Volley.

## Architecture
```
src/
  main.ts            boot, screen router
  engine/            pure TS, no DOM — unit-testable
    types.ts         shared types
    arena.ts         geometry, deploy zones, bridges, navigation helpers
    cards.ts         card + unit definitions and level scaling
    battle.ts        Battle: state, fixed-step update, deploy, targeting, combat, win logic
    powers.ts        commander powers
    ai.ts            AI opponent (threat assessment, counters, pushes)
  render/
    renderer.ts      canvas: arena, entities (y-sorted), projectiles, effects, HP bars
    sprites.ts       sprite loading, team recolor (blue->red), white hit-flash, fallbacks
    fx.ts            particles, floating numbers, screen shake
  audio/sfx.ts       WebAudio-synthesized sound effects
  meta/              profile save/load, progression, campaign data, chests, gauntlet
  ui/                DOM screens (home, deck, map, battle HUD, results), styles.css
public/assets/       processed sprites (cutouts) + manifest + icons
tools/               Grok batch generator + sprite cutout pipeline
```
Rendering: Canvas for the arena (DPR-aware, scaled to fit), DOM overlay for HUD and menus.
Sprites are single 3/4-view renders animated procedurally (bob, squash, lunge, flash, fade).
Enemy sprites are recolored at load (blue hues -> red).

## Asset pipeline
`node tools/gen-assets.mjs <shard> <shards>` drives `grok -p` (GenerateImage) per manifest entry
into `CLASH - assets/raw`. `python tools/cutout.py` removes the flat background, trims, resizes and
writes `public/assets/sprites/*.png`. Missing sprites fall back to procedural drawings.

## Testing
- Vitest unit tests for engine rules (mana, deploy zones, targeting, damage/splash, tower crowns, win logic, AI legality).
- Manual/automated play in the built-in browser at phone viewport (375x812) and on a real phone over LAN.
