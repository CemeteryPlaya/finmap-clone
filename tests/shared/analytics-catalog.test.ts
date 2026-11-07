import { describe, expect, it } from 'vitest';
import { BUILT_CLUB_REPORTS, CLUB_DASHBOARDS, CLUB_TILES, resolveDashboards, resolveTiles } from '../../src/shared/analytics-catalog';

/** Каталог дашбордов и плиток (спецификация «Аналитика клуба», §9–§10; план АК-1, задача 2). */
const AVAILABLE = [
  { key: 'finance', cards: ['cashflow', 'pnl'] },
  { key: 'computer-club', cards: ['overview', 'revenue'] },
];

describe('каталог аналитики', () => {
  it('без сохранённого — все группы и карточки видимы в порядке каталога', () => {
    expect(resolveDashboards(null, AVAILABLE)).toEqual({
      groups: [
        { key: 'finance', visible: true, cards: [{ key: 'cashflow', visible: true }, { key: 'pnl', visible: true }] },
        { key: 'computer-club', visible: true, cards: [{ key: 'overview', visible: true }, { key: 'revenue', visible: true }] },
      ],
    });
  });

  it('сохранённое: порядок и видимость остаются, неизвестное отбрасывается, новое — в конец видимым', () => {
    const saved = { groups: [{ key: 'computer-club', visible: false, cards: [{ key: 'revenue', visible: true }, { key: 'gone', visible: true }] }, { key: 'old-template', visible: true, cards: [] }] };
    expect(resolveDashboards(saved, AVAILABLE)).toEqual({
      groups: [
        { key: 'computer-club', visible: false, cards: [{ key: 'revenue', visible: true }, { key: 'overview', visible: true }] },
        { key: 'finance', visible: true, cards: [{ key: 'cashflow', visible: true }, { key: 'pnl', visible: true }] },
      ],
    });
  });

  it('плитки: без сохранённого — каталог по порядку, видимы плитки по умолчанию; сохранённое сводится так же', () => {
    const defaults = resolveTiles(null, CLUB_TILES);
    expect(defaults.items.map((i) => i.key)).toEqual(CLUB_TILES.map((t) => t.key));
    expect(defaults.items.filter((i) => i.visible).map((i) => i.key)).toEqual(['revenue', 'load', 'guests', 'newGuests', 'revenuePerGuest', 'revenuePerPcDay', 'barShare', 'barMargin']);
    const saved = resolveTiles({ items: [{ key: 'refills', visible: true }, { key: 'nope', visible: true }] }, CLUB_TILES);
    expect(saved.items[0]).toEqual({ key: 'refills', visible: true });
    expect(saved.items).toHaveLength(16);
    expect(saved.items.find((i) => i.key === 'revenue')).toEqual({ key: 'revenue', visible: true });
    expect(saved.items.find((i) => i.key === 'payrollToRevenue')).toEqual({ key: 'payrollToRevenue', visible: false });
  });

  it('карточка «Бар» (АК-4): в каталоге последней; отчёт построен; сохранённая настройка без неё — в конце видимой', () => {
    expect(CLUB_DASHBOARDS.map((d) => d.key)).toEqual(['overview', 'revenue', 'load', 'guests', 'bar']);
    expect(CLUB_DASHBOARDS.at(-1)).toMatchObject({ title: 'Бар', description: 'Продажи, маржа и остатки по товарам, ABC', path: 'club/bar' });
    expect(BUILT_CLUB_REPORTS.has('bar')).toBe(true);
    const club = { key: 'computer-club', cards: CLUB_DASHBOARDS.map((d) => d.key) };
    const got = resolveDashboards({ groups: [{ key: 'computer-club', visible: true, cards: [{ key: 'overview', visible: true }, { key: 'guests', visible: false }] }] }, [club]);
    expect(got.groups[0]!.cards.at(-1)).toEqual({ key: 'bar', visible: true });
  });

  it('16 плиток с уникальными ключами', () => {
    expect(CLUB_TILES).toHaveLength(16);
    expect(new Set(CLUB_TILES.map((t) => t.key)).size).toBe(16);
  });
});
