# Grokington Clash

A single-player, mobile-first 3D lane battler. Drop troops, spells and buildings on
your half of the arena, knock down the enemy's watchtowers and storm their keep.
Defeat six warlords across the campaign, or see how far you get in the Gauntlet.

**Play now:** https://binland23.github.io/grokington-clash/ — on iPhone, open it in Safari, then
Share → **Add to Home Screen** for a full-screen app. Every push to `main` redeploys it
(`.github/workflows/deploy.yml`).

## Play it on this PC

```bash
npm install
npm run dev
```

Open http://localhost:5173. Narrow the window (or use the browser's phone emulation) for
the intended portrait layout.

## Play it on your phone

1. Phone and PC on the same Wi-Fi.
2. `npm run dev` on the PC (it listens on the network).
3. On the phone open **http://192.168.1.86:5173** (the PC's LAN address; it can change —
   Vite prints the current "Network" URL when it starts).
4. Safari → Share → **Add to Home Screen** gives a full-screen app icon.

If the phone can't connect, Windows Firewall is blocking Node: allow "Node.js JavaScript
Runtime" on private networks when Windows asks, or in Windows Security → Firewall → Allow an app.

## How the game is built

| Folder | What lives there |
| --- | --- |
| `src/engine` | Pure TypeScript battle simulation (units, targeting, river/bridge pathing, spells, commander powers, AI). No DOM; unit tested. |
| `src/render3d` | Three.js renderer: arena, lighting/shadows, animated 3D units, particles, projectiles, overlays. |
| `src/ui` | Menus, battle HUD, touch input, campaign/cards/gauntlet screens. |
| `src/meta` | Save data, card levels, chests, campaign stages, gauntlet boons. |
| `src/audio` | Synthesized sound effects and music; recorded samples override them when present. |
| `public/assets` | Sprites (card art), 3D models (`models/*.glb`), icons. |
| `tools` | Asset pipeline (below). |

`npm test` runs the engine tests. `npm run build` makes a static build in `dist/`.

## Asset pipeline

All art starts in Grok:

1. `node tools/gen-assets.mjs <shard> <shards>` — Grok (`grok -p`) paints card art, icons,
   portraits and backgrounds into `CLASH - assets/raw`; `python tools/cutout.py` cuts them out
   into `public/assets/sprites` (and makes red enemy versions).
2. `node tools/gen-assets.mjs 0 1 --manifest asset-manifest-3d.json --out raw3d` — Grok paints
   neutral-pose 3D reference sheets for every model.
3. `tools/hy3d_batch.py` (run with the Hunyuan3D WinPortable Python in `C:\AI\HY3D2`) turns each
   sheet into a textured 3D mesh on the local GPU.
4. `python tools/build_models.py` runs Blender headless (`tools/blender_rig.py`) to clean,
   auto-rig and animate each mesh (idle / walk / attack / hit / death) and installs the GLBs.

The game falls back to the 2D art for any model that isn't built yet, so nothing breaks
while assets are in progress.
