import { describe, expect, it } from 'vitest';
import { toggleColumn, visibleColumns } from '../../src/client/lib/journal-columns';
import {
  clearFilter,
  EMPTY_JOURNAL_STATE,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  periodRange,
  type JournalUrlState,
} from '../../src/client/lib/journal-filter';
import {
  amountInputText,
  dayLabel,
  dayOf,
  lineDimension,
  pluralRu,
  projectShare,
  signedMoney,
  splitLabel,
  timeLabel,
} from '../../src/client/lib/journal-format';

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
    expect(dayLabel('2026-10-07', '2026-10-07')).toBe('сегодня');
    expect(dayLabel('2026-10-06', '2026-10-07')).toBe('вчера');
    expect(dayLabel('2025-12-31', '2026-01-01')).toBe('вчера');
    expect(dayLabel('2026-10-05', '2026-10-07')).toBe('05.10.2026');
  });

  it('множественное число и подпись разбитой операции', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => pluralRu(n, 'а', 'б', 'в')).join('')).toBe('аббввввабвав');
    expect(splitLabel(2, 'category')).toBe('2 статьи');
    expect(splitLabel(5, 'category')).toBe('5 статей');
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
    expect(signedMoney('expense', 500, 'USD')).toBe('\u22125,00\u00A0$');
    expect(signedMoney('transfer', 1000, 'JPY')).toBe('1\u202F000\u00A0¥');
    expect(amountInputText(150000, 2)).toBe('1500');
    expect(amountInputText(150050, 2)).toBe('1500,5');
    expect(amountInputText(5, 2)).toBe('0,05');
    expect(amountInputText(0, 2)).toBe('0');
    expect(amountInputText(1234, 0)).toBe('1234');
  });
});

describe('видимые колонки журнала', () => {
  it('нет настройки — все; неизвестные отбрасываются; дата и сумма всегда видны; порядок постоянный', () => {
    expect(visibleColumns(undefined)).toEqual(['date', 'amount', 'account', 'counterparty', 'category', 'project', 'comment']);
    expect(visibleColumns('мусор')).toHaveLength(7);
    expect(visibleColumns(['comment', 'bogus', 3, 'account'])).toEqual(['date', 'amount', 'account', 'comment']);
    expect(visibleColumns([])).toEqual(['date', 'amount']);
  });

  it('переключение колонки; дату и сумму выключить нельзя', () => {
    expect(toggleColumn(['date', 'amount', 'account', 'comment'], 'comment')).toEqual(['date', 'amount', 'account']);
    expect(toggleColumn(['date', 'amount', 'comment'], 'project')).toEqual(['date', 'amount', 'project', 'comment']);
    expect(toggleColumn(['date', 'amount'], 'date')).toEqual(['date', 'amount']);
  });
});
