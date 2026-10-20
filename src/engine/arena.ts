import type { Team, Vec } from './types';

export const ARENA_W = 18;
export const ARENA_H = 32;
export const RIVER_TOP = 15;
export const RIVER_BOTTOM = 17;
export const RIVER_MID = 16;
export const BRIDGES = [3.5, 14.5];
export const BRIDGE_HALF = 1.25;
export const CENTER_X = 9;

export interface TowerSpot {
  team: Team;
  type: 'keep' | 'watch';
  lane: -1 | 0 | 1; // -1 left, 1 right, 0 centre (keep)
  x: number;
  y: number;
  radius: number;
}

export const TOWER_SPOTS: TowerSpot[] = [
  { team: 0, type: 'keep', lane: 0, x: 9, y: 29, radius: 2 },
  { team: 0, type: 'watch', lane: -1, x: 3.5, y: 25.5, radius: 1.5 },
  { team: 0, type: 'watch', lane: 1, x: 14.5, y: 25.5, radius: 1.5 },
  { team: 1, type: 'keep', lane: 0, x: 9, y: 3, radius: 2 },
  { team: 1, type: 'watch', lane: -1, x: 3.5, y: 6.5, radius: 1.5 },
  { team: 1, type: 'watch', lane: 1, x: 14.5, y: 6.5, radius: 1.5 },
];

/** +1 below the river (player side), -1 above (enemy side), 0 in the river band. */
export function sideOf(y: number): -1 | 0 | 1 {
  if (y >= RIVER_BOTTOM) return 1;
  if (y <= RIVER_TOP) return -1;
  return 0;
}

export function teamSide(team: Team): -1 | 1 {
  return team === 0 ? 1 : -1;
}

/** Direction of travel toward the enemy, in y. */
export function forwardY(team: Team): -1 | 1 {
  return team === 0 ? -1 : 1;
}

/** Mirror a point to the other team's perspective. */
export function mirror(p: Vec): Vec {
  return { x: ARENA_W - p.x, y: ARENA_H - p.y };
}

export function onBridge(x: number, slack = 0): number | null {
  for (const b of BRIDGES) if (Math.abs(x - b) <= BRIDGE_HALF + slack) return b;
  return null;
}

export function inWater(x: number, y: number): boolean {
  return y > RIVER_TOP && y < RIVER_BOTTOM && onBridge(x) === null;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Best bridge for a ground trip from a to b. */
export function pickBridge(a: Vec, b: Vec): number {
  let best = BRIDGES[0];
  let bestCost = Infinity;
  for (const bx of BRIDGES) {
    const cost = Math.abs(a.x - bx) + Math.abs(b.x - bx);
    if (cost < bestCost) {
      bestCost = cost;
      best = bx;
    }
  }
  return best;
}

/**
 * Next point a ground unit should walk toward to reach `dest`, routing over a bridge
 * when the destination is across the river.
 */
export function groundWaypoint(pos: Vec, dest: Vec, radius: number): Vec {
  const s = sideOf(pos.y);
  const d = sideOf(dest.y);
  if (s === d && s !== 0) return dest;
  if (s === 0) {
    // In the river band: we must be on a bridge. Head straight for the far bank, then the target.
    const bx = onBridge(pos.x, 0.2) ?? pickBridge(pos, dest);
    const goingDown = dest.y > pos.y;
    if (d === 0) return dest;
    const exitY = goingDown ? RIVER_BOTTOM + 0.35 : RIVER_TOP - 0.35;
    const laneHalf = Math.max(0.1, BRIDGE_HALF - radius * 0.8);
    return { x: clamp(pos.x, bx - laneHalf, bx + laneHalf) + (bx - pos.x) * 0.15, y: exitY };
  }
  // On a bank, destination is on the other bank (or in the river).
  const bx = pickBridge(pos, dest);
  const nearEdge = s === 1 ? RIVER_BOTTOM : RIVER_TOP;
  const farEdge = s === 1 ? RIVER_TOP - 0.35 : RIVER_BOTTOM + 0.35;
  const laneHalf = Math.max(0.1, BRIDGE_HALF - radius * 0.8);
  const aligned = Math.abs(pos.x - bx) <= laneHalf;
  const distToRiver = Math.abs(pos.y - nearEdge);
  if (aligned && distToRiver < 2.2) return { x: clamp(pos.x, bx - laneHalf, bx + laneHalf), y: farEdge };
  // Approach point a little in front of the bridge so we line up before stepping on.
  return { x: bx, y: nearEdge + s * 0.9 };
}

/** Push a ground position out of the water. */
export function resolveWater(p: Vec, radius: number): void {
  if (!(p.y > RIVER_TOP - 0.01 && p.y < RIVER_BOTTOM + 0.01)) return;
  for (const b of BRIDGES) {
    const half = BRIDGE_HALF - radius * 0.5;
    if (Math.abs(p.x - b) <= half) return;
  }
  // Not on a bridge. Decide whether to push sideways onto a bridge or back to a bank.
  const b = BRIDGES.reduce((m, bx) => (Math.abs(p.x - bx) < Math.abs(p.x - m) ? bx : m), BRIDGES[0]);
  const half = BRIDGE_HALF - radius * 0.5;
  const sideDist = Math.abs(p.x - b) - half;
  const toTop = p.y - RIVER_TOP;
  const toBottom = RIVER_BOTTOM - p.y;
  const bankDist = Math.min(toTop, toBottom);
  if (sideDist < bankDist) {
    p.x = p.x < b ? b - half : b + half;
  } else if (toTop < toBottom) {
    p.y = RIVER_TOP;
  } else {
    p.y = RIVER_BOTTOM;
  }
}

/** Snap a deploy point to the tile grid centre. */
export function snapTile(v: number): number {
  return Math.floor(v) + 0.5;
}
