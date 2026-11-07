import { describe, expect, it } from 'vitest';
import { ANALYTICS_CARDS, analyticsGroups, type ClubScopeView } from '../../src/client/lib/analytics';
import type { AnalyticsSettingsView } from '../../src/client/lib/analytics-settings';
import { CLUB_DASHBOARDS, CLUB_TILES, resolveDashboards, resolveTiles } from '../../src/shared/analytics-catalog';

/** Главная «Аналитики»: группы карточек по настройкам (спецификация «Аналитика клуба», §2.1, §10.1; план АК-1, задача 4). */
const FIN = ANALYTICS_CARDS.map((c) => c.key);
const settings = (saved: Parameters<typeof resolveDashboards>[0] = null, club = true): AnalyticsSettingsView => ({
  dashboards: resolveDashboards(saved, [{ key: 'finance', cards: FIN }, ...(club ? [{ key: 'computer-club', cards: CLUB_DASHBOARDS.map((d) => d.key) }] : [])]),
  groups: [{ key: 'finance', title: 'Финансы' }, ...(club ? [{ key: 'computer-club', title: 'Компьютерный клуб' }] : [])],
  tiles: club ? { 'computer-club': resolveTiles(null, CLUB_TILES) } : {},
  catalog: club ? { 'computer-club': { dashboards: [...CLUB_DASHBOARDS], tiles: [...CLUB_TILES] } } : {},
});
const scope = (o: Partial<ClubScopeView> = {}): ClubScopeView => ({ projects: [{ id: 5, name: 'Клуб', archived: false, pcCount: 40 }], hasOffices: true, connected: true, freshness: null, ...o });
const keys = (g: { cards: { key: string }[] }) => g.cards.map((c) => c.key);

describe('главная «Аналитики»: группы карточек', () => {
  it('без группы клуба — финансовые карточки в порядке ANALYTICS_CARDS, у группы нет заголовка', () => {
    const groups = analyticsGroups(settings(null, false), null);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBeNull();
    expect(keys(groups[0]!)).toEqual(FIN);
  });

  it('скрытая карточка и скрытая группа не показываются; порядок — из настроек', () => {
    const saved = {
      groups: [
        { key: 'finance', visible: true, cards: [{ key: 'pnl', visible: false }] },
        { key: 'computer-club', visible: true, cards: [{ key: 'revenue', visible: true }, { key: 'overview', visible: true }] },
      ],
    };
    const [fin, club] = analyticsGroups(settings(saved), scope());
    expect(keys(fin!)).not.toContain('pnl');
    expect(club!.title).toBe('Компьютерный клуб');
    // «Загрузка» (АК-2), «Гости» (АК-3) и «Бар» (АК-4) не были в сохранённой настройке — в конце видимыми (§10.3)
    expect(keys(club!)).toEqual(['revenue', 'overview', 'load', 'guests', 'bar']);
    expect(club!.cards[0]!.href!(7)).toBe('/c/7/analytics/club/revenue');
    const hidden = analyticsGroups(settings({ groups: [{ key: 'computer-club', visible: false, cards: [] }] }), scope());
    expect(hidden.map((g) => g.key)).toEqual(['finance']);
  });

  it('клуб без Senet или без привязки клуба — карточки серые с подсказкой', () => {
    const off = analyticsGroups(settings(), scope({ connected: false, hasOffices: false }))[1]!;
    expect(off.cards.every((c) => c.href === null)).toBe(true);
    expect(off.cards[0]!.inactive).toBe('Подключите Senet в «Интеграциях»');
    const unbound = analyticsGroups(settings(), scope({ hasOffices: false }))[1]!;
    expect(unbound.cards[0]!.inactive).toBe('Привяжите клуб Senet к проекту в «Интеграциях»');
  });
});
