/**
 * Каталог «Аналитики» (спецификация «Аналитика клуба», §9–§10): ключи финансовых карточек, дашборды и плитки шаблона
 * «Компьютерный клуб» и сведение сохранённых настроек компании с каталогом. Общий для сервера, клиента и шаблонов.
 */

/** Отчёты клуба; `journal` — плитки, которые считаются по журналу (метрики шаблона). */
export type ClubReportKey = 'overview' | 'revenue' | 'load' | 'guests' | 'bar';

/** Карточка дашборда шаблона. `path` — хвост адреса после `/c/:id/analytics/`. */
export interface DashboardDef {
  key: string;
  title: string;
  description: string;
  help: string;
  path: string;
}

/** Плитка «Обзора» (§4): `byDefault` — видна, пока компания не настроила плитки. */
export interface TileDef {
  key: string;
  label: string;
  unit: 'money' | 'percent' | 'number' | 'duration';
  byDefault: boolean;
  report: ClubReportKey | 'journal';
}

/** Карточки финансовой группы по порядку §2.1 спецификации «Аналитика»; подписи — у клиента (`ANALYTICS_CARDS`). */
export const FINANCE_CARD_KEYS = ['cashflow', 'pnl', 'statement', 'projects', 'indicators', 'history'] as const;

/** Ключ и подпись финансовой группы в настройках. */
export const FINANCE_GROUP = { key: 'finance', title: 'Финансы' } as const;

/** Дашборды «Компьютерного клуба» (§2.1). */
export const CLUB_DASHBOARDS: readonly DashboardDef[] = [
  {
    key: 'overview',
    title: 'Обзор клуба',
    description: 'Главные цифры периода и сравнение с прошлым',
    help: 'Выручка, загрузка, гости и бар за период — и насколько они изменились по сравнению с прошлым периодом той же длины. Плитки выбираются в «Настройках → Аналитика».',
    path: 'club',
  },
  {
    key: 'revenue',
    title: 'Выручка клуба',
    description: 'На что гости тратят деньги: часы, бар; по оплате, сменам, кассирам, часам',
    help: 'Выручка — то, что гости потратили: на часы и в баре. Рядом справочно — деньги, поступившие в кассу (как в «Сверке» и журнале), и пополнения балансов гостей.',
    path: 'club/revenue',
  },
  {
    key: 'load',
    title: 'Загрузка',
    description: 'Загрузка ПК по часам, дням недели и зонам',
    help: 'Сколько ПК занято: по часам, дням недели и зонам. Загрузка часа — занятое время мест, делённое на число ПК. Средние — только по дням с полными данными.',
    path: 'club/load',
  },
  {
    key: 'guests',
    title: 'Гости',
    description: 'Уникальные, новые и вернувшиеся гости, когорты, постоянные гости',
    help: 'Гость — связанные логины и телефоны: логины с общим телефоном считаются одним гостем. Визит — сеансы с перерывом меньше 30 минут. Новый — первый визит за всё время данных попал в период. Одноразовые чеки (логин — код чека) не гости: они считаются отдельно и входят в «Посещений всего».',
    path: 'club/guests',
  },
  {
    key: 'bar',
    title: 'Бар',
    description: 'Продажи, маржа и остатки по товарам, ABC',
    help: 'Продажи бара по товарам и категориям: выручка, себестоимость по цене прихода, прибыль, маржа, списания, остаток и на сколько дней его хватит, ABC по выручке. Ниже — закупки из кассы и приход в Senet.',
    path: 'club/bar',
  },
];

/** Каталог плиток «Обзора» (§4): восемь по умолчанию, затем остальные. */
export const CLUB_TILES: readonly TileDef[] = [
  { key: 'revenue', label: 'Выручка', unit: 'money', byDefault: true, report: 'revenue' },
  { key: 'load', label: 'Загрузка ПК', unit: 'percent', byDefault: true, report: 'load' },
  { key: 'guests', label: 'Гостей', unit: 'number', byDefault: true, report: 'guests' },
  { key: 'newGuests', label: 'Новых гостей', unit: 'number', byDefault: true, report: 'guests' },
  { key: 'revenuePerGuest', label: 'Выручка на гостя', unit: 'money', byDefault: true, report: 'guests' },
  { key: 'revenuePerPcDay', label: 'Выручка на ПК в день', unit: 'money', byDefault: true, report: 'revenue' },
  { key: 'barShare', label: 'Доля бара', unit: 'percent', byDefault: true, report: 'revenue' },
  { key: 'barMargin', label: 'Маржа бара', unit: 'percent', byDefault: true, report: 'bar' },
  { key: 'refills', label: 'Пополнения балансов', unit: 'money', byDefault: false, report: 'revenue' },
  { key: 'visitDuration', label: 'Средняя длительность визита', unit: 'duration', byDefault: false, report: 'guests' },
  { key: 'visitsPerGuest', label: 'Визитов на гостя', unit: 'number', byDefault: false, report: 'guests' },
  { key: 'returningShare', label: 'Вернувшиеся гости', unit: 'percent', byDefault: false, report: 'guests' },
  { key: 'visitsAll', label: 'Посещений', unit: 'number', byDefault: false, report: 'guests' },
  { key: 'checks', label: 'Одноразовых чеков', unit: 'number', byDefault: false, report: 'guests' },
  { key: 'payrollToRevenue', label: 'ФОТ к выручке', unit: 'percent', byDefault: false, report: 'journal' },
  { key: 'rentToRevenue', label: 'Аренда к выручке', unit: 'percent', byDefault: false, report: 'journal' },
];

/** Отчёты, которые уже построены: плитка чужого отчёта недоступна с пометкой `TILE_SOON` (§15). */
export const BUILT_CLUB_REPORTS: ReadonlySet<ClubReportKey | 'journal'> = new Set(['overview', 'revenue', 'load', 'guests', 'bar', 'journal']);

export const TILE_SOON: Record<'load' | 'guests' | 'bar', string> = {
  load: 'Появится с отчётом «Загрузка»',
  guests: 'Появится с отчётом «Гости»',
  bar: 'Появится с отчётом «Бар»',
};

/** Видимых плиток «Обзора» не больше (§10.2). */
export const TILES_MAX = 12;

export interface SavedDashboards {
  groups: { key: string; visible: boolean; cards: { key: string; visible: boolean }[] }[];
}

export interface SavedTiles {
  items: { key: string; visible: boolean }[];
}

/** Сохранённые элементы, известные каталогу, в своём порядке; новые элементы каталога — в конец с видимостью по умолчанию. */
function reconcile<S extends { key: string }>(saved: readonly S[], known: readonly string[], fresh: (key: string) => S): S[] {
  const kept = saved.filter((s) => known.includes(s.key));
  const seen = new Set(kept.map((s) => s.key));
  return [...kept, ...known.filter((k) => !seen.has(k)).map(fresh)];
}

/** Настройка дашбордов, сведённая с каталогом (§10.3): неизвестные группы и карточки отбрасываются, новые — в конец видимыми. */
export function resolveDashboards(saved: SavedDashboards | null, available: readonly { key: string; cards: readonly string[] }[]): SavedDashboards {
  const keys = available.map((g) => g.key);
  const groups = reconcile(saved?.groups ?? [], keys, (key) => ({ key, visible: true, cards: [] }));
  return {
    groups: groups.map((g) => {
      const cards = available.find((a) => a.key === g.key)!.cards;
      return { key: g.key, visible: g.visible, cards: reconcile(g.cards, cards, (key) => ({ key, visible: true })) };
    }),
  };
}

/** Плитки шаблона, сведённые с каталогом; без сохранённого — каталог по порядку, видимы плитки `byDefault`. */
export function resolveTiles(saved: SavedTiles | null, catalog: readonly TileDef[]): SavedTiles {
  const byDefault = new Map(catalog.map((t) => [t.key, t.byDefault]));
  return { items: reconcile(saved?.items ?? [], [...byDefault.keys()], (key) => ({ key, visible: byDefault.get(key)! })) };
}
