import { CARDS, UNITS, levelMul } from '../engine/cards';
import { spriteUrl } from '../render/sprites';
import { h, img } from './dom';

export function cardView(id: string, o: { level?: number; locked?: boolean; cost?: boolean; upgradable?: boolean } = {}): HTMLElement {
  const c = CARDS[id];
  const cls = ['card', c.rarity, c.type === 'spell' ? 'spell' : '', o.locked ? 'locked' : ''].join(' ');
  // Prefer the portrait rendered from the unit's 3D model so cards match the battlefield.
  const art = (c.unit && spriteUrl(`card_${c.unit}`)) || spriteUrl(c.icon);
  return h('div', { class: cls },
    img(art, 'art', c.name),
    o.cost === false ? null : h('div', { class: 'cost' }, String(c.cost)),
    o.level !== undefined && !o.locked ? h('div', { class: 'lvl' }, `Lvl ${o.level}`) : null,
    o.upgradable ? h('div', { class: 'badge-up' }, '▲') : null,
  );
}

export function crownIcon(cls = ''): HTMLElement {
  return img(spriteUrl('ui_crown'), cls, 'crown');
}

export interface StatLine {
  k: string;
  v: string;
  next?: string;
}

export function cardStats(id: string, level: number): StatLine[] {
  const c = CARDS[id];
  const lm = levelMul(level);
  const ln = levelMul(level + 1);
  const out: StatLine[] = [];
  if (c.unit) {
    const u = UNITS[c.unit];
    const count = c.count ?? 1;
    out.push({ k: 'Hitpoints', v: String(Math.round(u.hp * lm)), next: `+${Math.round(u.hp * (ln - lm))}` });
    if (u.damage > 0) {
      out.push({ k: u.splash ? 'Area damage' : 'Damage', v: String(Math.round(u.damage * lm)), next: `+${Math.round(u.damage * (ln - lm))}` });
      out.push({ k: 'Hit speed', v: `${u.hitSpeed}s` });
      out.push({ k: 'Range', v: u.range < 1.2 ? 'Melee' : `${u.range}` });
      out.push({ k: 'Targets', v: u.targets === 'buildings' ? 'Buildings' : u.targets === 'both' ? 'Air & Ground' : 'Ground' });
    }
    if (u.spawn) out.push({ k: 'Spawns', v: `${UNITS[u.spawn.unit].name} / ${u.spawn.interval}s` });
    if (u.speed > 0) out.push({ k: 'Speed', v: u.speed >= 2 ? 'Very fast' : u.speed >= 1.5 ? 'Fast' : u.speed >= 1 ? 'Medium' : 'Slow' });
    if (u.lifetime) out.push({ k: 'Lifetime', v: `${u.lifetime}s` });
    if (count > 1) out.push({ k: 'Count', v: `x${count}` });
    if (u.flying) out.push({ k: 'Type', v: 'Flying' });
  } else if (c.spell) {
    const s = c.spell;
    if (s.damage) out.push({ k: 'Damage', v: String(Math.round(s.damage * lm)), next: `+${Math.round(s.damage * (ln - lm))}` });
    if (s.damage && s.towerMul) out.push({ k: 'Tower damage', v: String(Math.round(s.damage * lm * s.towerMul)) });
    out.push({ k: 'Radius', v: String(s.radius) });
    if (s.stun) out.push({ k: 'Stun', v: `${s.stun}s` });
    if (s.freeze) out.push({ k: 'Freeze', v: `${s.freeze}s` });
    if (s.rage) out.push({ k: 'Boost', v: `+${Math.round((s.rage.mul - 1) * 100)}%` });
    if (s.heal) out.push({ k: 'Heal / sec', v: String(Math.round(s.heal * lm)), next: `+${Math.round(s.heal * (ln - lm))}` });
    if (s.duration) out.push({ k: 'Duration', v: `${s.duration}s` });
  }
  return out;
}
