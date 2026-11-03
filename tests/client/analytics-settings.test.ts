import { describe, expect, it } from 'vitest';
import { moveCard, moveTile, toggleCard, toggleGroup, toggleTile, visibleTileCount } from '../../src/client/lib/analytics-settings';
import type { SavedDashboards, SavedTiles } from '../../src/shared/analytics-catalog';

/** «Настройки → Аналитика» (спецификация «Аналитика клуба», §10.1–10.2; план АК-1, задача 3). */
const D: SavedDashboards = {
  groups: [
    { key: 'finance', visible: true, cards: [{ key: 'cashflow', visible: true }, { key: 'pnl', visible: true }, { key: 'statement', visible: true }] },
    { key: 'computer-club', visible: true, cards: [{ key: 'overview', visible: true }] },
  ],
};
const cards = (d: SavedDashboards, g = 0) => d.groups[g]!.cards.map((c) => c.key);
const tiles = (visible: number, total = 14): SavedTiles => ({ items: Array.from({ length: total }, (_, i) => ({ key: `t${i}`, visible: i < visible })) });

describe('настройки аналитики: правки', () => {
  it('moveCard: первую вверх и последнюю вниз — без изменений; среднюю — меняет с соседом', () => {
    expect(moveCard(D, 'finance', 'cashflow', -1)).toBe(D);
    expect(moveCard(D, 'finance', 'statement', 1)).toBe(D);
    expect(cards(moveCard(D, 'finance', 'pnl', -1))).toEqual(['pnl', 'cashflow', 'statement']);
    expect(cards(moveCard(D, 'finance', 'pnl', 1))).toEqual(['cashflow', 'statement', 'pnl']);
    expect(cards(D)).toEqual(['cashflow', 'pnl', 'statement']);
  });

  it('toggleCard и toggleGroup: группа прячется целиком, карточки не трогаются', () => {
    const hidden = toggleCard(D, 'finance', 'pnl');
    expect(hidden.groups[0]!.cards[1]).toEqual({ key: 'pnl', visible: false });
    const group = toggleGroup(D, 'computer-club');
    expect(group.groups[1]).toEqual({ key: 'computer-club', visible: false, cards: [{ key: 'overview', visible: true }] });
  });

  it('плитки: при 12 видимых невидимую включить нельзя, видимую выключить можно; порядок стрелками', () => {
    const full = tiles(12);
    expect(visibleTileCount(full)).toBe(12);
    expect(toggleTile(full, 't13')).toBe(full);
    expect(visibleTileCount(toggleTile(full, 't0'))).toBe(11);
    expect(visibleTileCount(toggleTile(tiles(3), 't5'))).toBe(4);
    expect(moveTile(full, 't0', -1)).toBe(full);
    expect(moveTile(full, 't0', 1).items.slice(0, 2).map((i) => i.key)).toEqual(['t1', 't0']);
  });
});
