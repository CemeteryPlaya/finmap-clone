import { describe, expect, it } from 'vitest';
import { JOURNAL_COLUMNS, toggleColumn, visibleColumns } from '../../src/client/lib/journal-columns';
import {
  applyDialogFields,
  clearFilter,
  EMPTY_JOURNAL_STATE,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  PERIODS,
  periodLabel,
  periodRange,
  pickDialogFields,
  withPeriod,
  type JournalUrlState,
} from '../../src/client/lib/journal-filter';
import {
  amountInputText,
  categoryLookup,
  dayOf,
  journalDateParts,
  lineDimension,
  pluralRu,
  projectShare,
  signedMoney,
  splitLabel,
  timeLabel,
} from '../../src/client/lib/journal-format';
import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';

const parse = (qs: string) => parseJournalSearch(new URLSearchParams(qs));
const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('periodRange — периоды тулбара от «сегодня» в APP_TIMEZONE', () => {
  it('среда 07.10.2026: сегодня, вчера, неделя с понедельника, месяц, год', () => {
    const today = '2026-10-07';
    const r = (period: JournalUrlState['period']) => periodRange({ period }, today);
    expect(r('all')).toEqual({});
    expect(r('today')).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(r('yesterday')).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    expect(r('week')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(r('lastWeek')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(r('month')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r('lastMonth')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(r('year')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange({ period: 'custom', from: '2026-01-05' }, today)).toEqual({ from: '2026-01-05' });
  });

  it('границы года, месяца и недели: 1 января — четверг, воскресенье, високосный февраль', () => {
    expect(periodRange({ period: 'week' }, '2026-01-01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(periodRange({ period: 'lastWeek' }, '2026-01-01')).toEqual({ from: '2025-12-22', to: '2025-12-28' });
    expect(periodRange({ period: 'lastMonth' }, '2026-01-01')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange({ period: 'yesterday' }, '2026-01-01')).toEqual({ from: '2025-12-31', to: '2025-12-31' });
    expect(periodRange({ period: 'week' }, '2026-03-01')).toEqual({ from: '2026-02-23', to: '2026-03-01' });
    expect(periodRange({ period: 'month' }, '2024-02-29')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('меню периода (§5.1 этапа 1.5)', () => {
  it('пункты и порядок как в Finmap; наши «За сегодня» и «За вчера» — перед «Выбрать даты»', () => {
    expect(PERIODS.map((p) => p.label)).toEqual([
      'За текущий год',
      'За предыдущий год',
      'За текущую неделю',
      'За прошлую неделю',
      'За текущий месяц',
      'За прошлый месяц',
      'За все время',
      'За сегодня',
      'За вчера',
      'Выбрать даты',
    ]);
    expect(PERIODS.map((p) => p.key)).toEqual(['year', 'lastYear', 'week', 'lastWeek', 'month', 'lastMonth', 'all', 'today', 'yesterday', 'custom']);
  });

  it('«За предыдущий год» — с 1 января по 31 декабря прошлого года; ключ в адресе — lastYear', () => {
    expect(periodRange({ period: 'lastYear' }, '2026-10-07')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodRange({ period: 'lastYear' }, '2026-01-01')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(parse('period=lastYear').period).toBe('lastYear');
    expect(journalSearch(state({ period: 'lastYear' })).toString()).toBe('period=lastYear');
  });

  it('withPeriod: у обычного периода границ нет; «Выбрать даты» — одна или две границы, перепутанные меняются местами (Review Focus 2)', () => {
    const custom = state({ period: 'custom', from: '2026-10-01', to: '2026-10-05', q: 'аренда' });
    expect(withPeriod(custom, 'month')).toEqual(state({ period: 'month', q: 'аренда' }));
    expect(withPeriod(state({}), 'custom', { from: '2026-10-10', to: '2026-10-04' })).toEqual(state({ period: 'custom', from: '2026-10-04', to: '2026-10-10' }));
    expect(withPeriod(state({}), 'custom', { to: '2026-10-04' })).toEqual(state({ period: 'custom', to: '2026-10-04' }));
    expect(withPeriod(state({ period: 'today' }), 'custom', {})).toEqual(state({ period: 'custom' }));
  });

  it('подпись пилюли: пункт меню или даты', () => {
    expect(periodLabel({ period: 'all' })).toBe('За все время');
    expect(periodLabel({ period: 'lastYear' })).toBe('За предыдущий год');
    expect(periodLabel({ period: 'custom', from: '2026-10-04', to: '2026-10-10' })).toBe('04.10.2026 – 10.10.2026');
    expect(periodLabel({ period: 'custom', from: '2026-10-04', to: '2026-10-04' })).toBe('04.10.2026');
    expect(periodLabel({ period: 'custom', from: '2026-10-04' })).toBe('с 04.10.2026');
    expect(periodLabel({ period: 'custom', to: '2026-10-10' })).toBe('по 10.10.2026');
    expect(periodLabel({ period: 'custom' })).toBe('Выбрать даты');
  });
});

describe('поля модалки «Фильтр» накладываются на текущий фильтр', () => {
  const dialog = {
    types: ['expense'],
    accountIds: [1],
    categoryIds: [2],
    projectIds: [3],
    counterpartyIds: [4],
    tagIds: [5],
    withoutCategory: true,
    withoutProject: true,
    withoutCounterparty: true,
  } satisfies ReturnType<typeof pickDialogFields>;

  it('pickDialogFields берёт только поля модалки', () => {
    const full = state({ ...dialog, q: 'аренда', amountMin: 100, period: 'month', sort: 'amount', order: 'asc' });
    expect(pickDialogFields(full)).toEqual(dialog);
  });

  it('applyDialogFields меняет только поля модалки: поиск, период, сумма и сортировка текущего фильтра остаются', () => {
    const current = state({ q: 'аренда', amountMax: 500, period: 'month', sort: 'amount', order: 'asc', accountIds: [9] });
    expect(applyDialogFields(current, dialog)).toEqual({ ...current, ...dialog });
    const cleared = applyDialogFields(current, pickDialogFields(EMPTY_JOURNAL_STATE));
    expect(cleared).toEqual({ ...current, ...pickDialogFields(EMPTY_JOURNAL_STATE) });
    expect(cleared.q).toBe('аренда');
  });
});

describe('адресная строка ↔ фильтр', () => {
  it('пустая строка — фильтр по умолчанию; ?account=5 из левой панели — фильтр по счёту', () => {
    expect(parse('')).toEqual(EMPTY_JOURNAL_STATE);
    expect(parse('account=5')).toEqual(state({ accountIds: [5] }));
  });

  it('туда и обратно: все поля сохраняются, строка — без значений по умолчанию', () => {
    const full = state({
      period: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
      q: 'Аренда 100%',
      amountMin: 100000,
      amountMax: 500000,
      types: ['income', 'transfer'],
      accountIds: [1, 7],
      categoryIds: [3],
      projectIds: [4],
      counterpartyIds: [9],
      tagIds: [2],
      withoutCategory: true,
      withoutProject: true,
      withoutCounterparty: true,
      sort: 'amount',
      order: 'asc',
    });
    const qs = journalSearch(full).toString();
    expect(qs).toBe(
      'from=2026-01-01&to=2026-01-31&q=%D0%90%D1%80%D0%B5%D0%BD%D0%B4%D0%B0+100%25&min=100000&max=500000&type=income&type=transfer' +
        '&account=1&account=7&category=3&project=4&counterparty=9&tag=2&noCategory=1&noProject=1&noCounterparty=1&sort=amount&order=asc',
    );
    expect(parse(qs)).toEqual(full);
    expect(journalSearch(EMPTY_JOURNAL_STATE).toString()).toBe('');
    expect(journalSearch(state({ period: 'month' })).toString()).toBe('period=month');
    expect(journalSearch(state({ period: 'custom' })).toString()).toBe('period=custom');
    expect(parse('period=custom')).toEqual(state({ period: 'custom' }));
  });

  it('ручная правка адреса не ломает журнал: мусор отбрасывается, перепутанные границы меняются местами', () => {
    expect(parse('account=abc&account=0&account=-3&account=12&account=12&type=bogus&type=expense&sort=name&order=up&noCategory=yes')).toEqual(
      state({ accountIds: [12], types: ['expense'] }),
    );
    expect(parse('from=2026-02-31&to=2026-03-05')).toEqual(state({ period: 'custom', to: '2026-03-05' }));
    // сервер не принимает даты с годом 9999 — из адреса они отбрасываются
    expect(parse('from=9999-01-01&to=9999-12-31')).toEqual(EMPTY_JOURNAL_STATE);
    expect(parse('from=9998-12-31&to=9999-12-31')).toEqual(state({ period: 'custom', from: '9998-12-31' }));
    expect(parse('from=2026-03-05&to=2026-03-01')).toEqual(state({ period: 'custom', from: '2026-03-01', to: '2026-03-05' }));
    expect(parse('min=500&max=100')).toMatchObject({ amountMin: 100, amountMax: 500 });
    expect(parse('min=1.5&max=99999999999999999')).toEqual(EMPTY_JOURNAL_STATE);
    expect(parse(`q=${'я'.repeat(300)}`).q).toHaveLength(200);
    expect(parse('q=%20%20')).toEqual(EMPTY_JOURNAL_STATE);
    // списков не больше, чем принимает сервер (JOURNAL_LIST_MAX) — иначе журнал получил бы 400
    const many = new URLSearchParams(Array.from({ length: 250 }, (_, i) => ['account', String(i + 1)]));
    expect(parseJournalSearch(many).accountIds).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    // относительный период важнее дат: «текущий месяц» после перезагрузки остаётся текущим
    expect(parse('period=month&from=2020-01-01')).toEqual(state({ period: 'month' }));
  });

  it('параметры API (план 5a): период датами, списки повтором ключа, флаги true, сортировка всегда', () => {
    const p = journalApiParams(state({ period: 'today', q: 'бар', amountMin: 100, types: ['expense'], accountIds: [1, 2], withoutProject: true }), '2026-10-07');
    expect(p.toString()).toBe(
      'from=2026-10-07&to=2026-10-07&q=%D0%B1%D0%B0%D1%80&amountMin=100&types=expense&accountIds=1&accountIds=2&withoutProject=true&sort=date&order=desc',
    );
    expect(journalApiParams(EMPTY_JOURNAL_STATE, '2026-10-07').toString()).toBe('sort=date&order=desc');
  });

  it('число условий модалки, «есть фильтр» и сброс с сохранением сортировки', () => {
    expect(filterConditionCount(state({ accountIds: [1], categoryIds: [2], withoutCategory: true, withoutCounterparty: true }))).toBe(3);
    expect(filterConditionCount(state({ q: 'x', period: 'today' }))).toBe(0);
    expect(isFiltered(EMPTY_JOURNAL_STATE)).toBe(false);
    expect(isFiltered(state({ sort: 'amount' }))).toBe(false);
    expect(isFiltered(state({ amountMax: 0 }))).toBe(true);
    expect(isFiltered(state({ period: 'year' }))).toBe(true);
    expect(clearFilter(state({ q: 'x', tagIds: [1], sort: 'amount', order: 'asc' }))).toEqual(state({ sort: 'amount', order: 'asc' }));
  });
});

describe('форматирование строк журнала', () => {
  it('дата и время — в поясе приложения: 23:30 и 00:30 по Алматы — разные дни', () => {
    expect(dayOf('2026-10-04T18:30:00.000Z', 'Asia/Almaty')).toBe('2026-10-04');
    expect(dayOf('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBe('2026-10-05');
    expect(timeLabel('2026-10-04T19:30:00.000Z', 'Asia/Almaty')).toBe('00:30');
    expect(timeLabel('2026-10-04T18:05:00.000Z', 'Asia/Almaty')).toBe('23:05');
  });

  it('дата в журнале в две строки: «4 окт. 2026» и время; сегодня и вчера — с префиксом; граница суток по Алматы (§5.2 этапа 1.5)', () => {
    const tz = 'Asia/Almaty';
    // 05:30 UTC = 10:30 по Алматы
    expect(journalDateParts('2026-10-07T05:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '7 окт. 2026', time: 'Сегодня 10:30' });
    expect(journalDateParts('2026-10-06T05:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '6 окт. 2026', time: 'Вчера 10:30' });
    expect(journalDateParts('2026-10-04T05:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '4 окт. 2026', time: '10:30' });
    // 23:30 6 октября по Алматы — ещё вчера; 00:30 7 октября — уже сегодня
    expect(journalDateParts('2026-10-06T18:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '6 окт. 2026', time: 'Вчера 23:30' });
    expect(journalDateParts('2026-10-06T19:30:00.000Z', tz, '2026-10-07')).toEqual({ date: '7 окт. 2026', time: 'Сегодня 00:30' });
  });

  it('справочник категорий журнала: «Родитель → Дочерняя» и собственный systemKey — бейдж только у самой системной (§5.2, §10.3)', () => {
    const node = (id: number, name: string, systemKey: string | null, children: CategoryNode[] = []): CategoryNode => ({
      id,
      companyId: 1,
      kind: 'expense',
      parentId: null,
      name,
      systemKey,
      effectiveSystemKey: systemKey,
      templateRef: null,
      orderIndex: 0,
      archivedAt: null,
      children,
    });
    const tree: CategoryTree = {
      income: [node(1, 'Выручка', null)],
      expense: [node(10, 'Зарплата', 'salary', [{ ...node(11, 'Администраторы', null), parentId: 10, effectiveSystemKey: 'salary' }])],
    };
    expect([...categoryLookup(tree)]).toEqual([
      [1, { name: 'Выручка', systemKey: null }],
      [10, { name: 'Зарплата', systemKey: 'salary' }],
      [11, { name: 'Зарплата → Администраторы', systemKey: null }],
    ]);
  });

  it('множественное число и подпись разбитой операции', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => pluralRu(n, 'а', 'б', 'в')).join('')).toBe('аббввввабвав');
    expect(splitLabel(2, 'category')).toBe('2 категории');
    expect(splitLabel(5, 'category')).toBe('5 категорий');
    expect(splitLabel(21, 'project')).toBe('21 проект');
    expect(splitLabel(3, 'project')).toBe('3 проекта');
  });

  it('измерение строк: одно значение на все строки или несколько разных («не указано» — тоже значение)', () => {
    const l = (categoryId: number | null, projectId: number | null, amount = 100) => ({ categoryId, projectId, amount });
    expect(lineDimension([], 'projectId')).toEqual({ kind: 'single', id: null });
    expect(lineDimension([l(1, null)], 'categoryId')).toEqual({ kind: 'single', id: 1 });
    expect(lineDimension([l(1, 5), l(1, 6)], 'categoryId')).toEqual({ kind: 'single', id: 1 });
    expect(lineDimension([l(1, 5), l(1, 6)], 'projectId')).toEqual({ kind: 'many', count: 2 });
    expect(lineDimension([l(1, 5), l(null, 5), l(2, 5)], 'categoryId')).toEqual({ kind: 'many', count: 3 });
  });

  it('доля проекта — только у разбитой операции и при фильтре по проекту', () => {
    const lines = [
      { categoryId: 1, projectId: 5, amount: 400 },
      { categoryId: 1, projectId: 6, amount: 600 },
      { categoryId: 1, projectId: null, amount: 50 },
    ];
    expect(projectShare(lines, [5])).toBe(400);
    expect(projectShare(lines, [5, 6])).toBe(1000);
    expect(projectShare(lines, [7])).toBe(0);
    expect(projectShare(lines, [])).toBeNull();
    expect(projectShare([lines[0]!], [5])).toBeNull();
  });

  it('сумма со знаком по типу и текст поля суммы', () => {
    expect(signedMoney('income', 150050, 'KZT')).toBe('+1\u202F500,50\u00A0₸');
    expect(signedMoney('expense', 500, 'USD')).toBe('\u22125\u00A0$');
    expect(signedMoney('transfer', 1000, 'JPY')).toBe('1\u202F000\u00A0¥');
    expect(amountInputText(150000, 2)).toBe('1500');
    expect(amountInputText(150050, 2)).toBe('1500,5');
    expect(amountInputText(5, 2)).toBe('0,05');
    expect(amountInputText(0, 2)).toBe('0');
    expect(amountInputText(1234, 0)).toBe('1234');
  });
});

describe('видимые колонки журнала', () => {
  it('нет настройки — все, кроме «Даты сделки»; неизвестные отбрасываются; дата и сумма всегда видны; порядок постоянный (Review Focus 5)', () => {
    expect(visibleColumns(undefined)).toEqual(['date', 'amount', 'account', 'counterparty', 'category', 'project', 'comment']);
    expect(visibleColumns('мусор')).toHaveLength(7);
    expect(visibleColumns(['comment', 'bogus', 3, 'account'])).toEqual(['date', 'amount', 'account', 'comment']);
    expect(visibleColumns([])).toEqual(['date', 'amount']);
    // массив, сохранённый до плана 1.5-2, «Дату сделки» не знает — она выключена; включённая — третья
    expect(visibleColumns(['account', 'counterparty', 'category', 'project', 'comment'])).not.toContain('accrualDate');
    expect(visibleColumns(['comment', 'accrualDate'])).toEqual(['date', 'amount', 'accrualDate', 'comment']);
    expect(JOURNAL_COLUMNS.map((c) => c.label)).toEqual(['Дата', 'Сумма', 'Дата сделки', 'Счёт/остаток', 'Контрагент', 'Категория', 'Проект', 'Комментарий']);
  });

  it('переключение колонки; дату и сумму выключить нельзя', () => {
    expect(toggleColumn(['date', 'amount', 'account', 'comment'], 'comment')).toEqual(['date', 'amount', 'account']);
    expect(toggleColumn(['date', 'amount', 'comment'], 'project')).toEqual(['date', 'amount', 'project', 'comment']);
    expect(toggleColumn(['date', 'amount'], 'date')).toEqual(['date', 'amount']);
    expect(toggleColumn(['date', 'amount', 'account'], 'accrualDate')).toEqual(['date', 'amount', 'accrualDate', 'account']);
  });
});
