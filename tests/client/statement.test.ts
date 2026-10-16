import { describe, expect, it } from 'vitest';
import { deltaMoney } from '../../src/client/lib/journal-format';
import { DEFAULT_REPORT_STATE, parseReportSearch, reportSearch } from '../../src/client/lib/report-url';
import { statementAccountChoices, statementAccountId, statementApiParams, statementExcelHref, statementState } from '../../src/client/lib/statement';
import { statementSummary } from '../../src/shared/report-statement';

const TODAY = '2026-10-16';
const parse = (qs: string) => statementState(parseReportSearch(new URLSearchParams(qs)));
const accounts = [
  { id: 3, name: 'Старая касса', archivedAt: '2026-01-01T00:00:00.000Z' },
  { id: 5, name: 'Касса Клуб 1', archivedAt: null },
  { id: 7, name: 'Kaspi', archivedAt: null },
];

describe('«Выписка по счету»: адрес, счёт, API (§6)', () => {
  it('из адреса — только период и первый счёт; остальное отбрасывается', () => {
    const s = parse('account=7&account=5&category=3&by=project&step=day&view=table&pct=1&stock=0&period=month');
    expect(s).toEqual({ ...DEFAULT_REPORT_STATE, period: 'month', accountIds: [5] });
    expect(reportSearch(s).toString()).toBe('period=month&account=5');
    expect(parse('from=2026-10-01&to=2026-10-05&account=7')).toEqual({ ...DEFAULT_REPORT_STATE, period: 'custom', from: '2026-10-01', to: '2026-10-05', accountIds: [7] });
  });

  it('счёт: выбранный в адресе — даже архивный; без выбора — первый неархивный по порядку; нет счетов — null', () => {
    expect(statementAccountId({ accountIds: [] }, accounts)).toBe(5);
    expect(statementAccountId({ accountIds: [7] }, accounts)).toBe(7);
    expect(statementAccountId({ accountIds: [3] }, accounts)).toBe(3);
    expect(statementAccountId({ accountIds: [99] }, accounts)).toBe(5);
    expect(statementAccountId({ accountIds: [] }, [accounts[0]!])).toBeNull();
    expect(statementAccountId({ accountIds: [] }, [])).toBeNull();
  });

  it('меню «Счёт»: неархивные по порядку; архивный — только выбранный, с пометкой «(архив)»', () => {
    expect(statementAccountChoices(accounts, 5)).toEqual([
      { value: '5', label: 'Касса Клуб 1' },
      { value: '7', label: 'Kaspi' },
    ]);
    expect(statementAccountChoices(accounts, 3).map((c) => c.label)).toEqual(['Старая касса (архив)', 'Касса Клуб 1', 'Kaspi']);
  });

  it('API и Excel: счёт и период датами', () => {
    expect(statementApiParams({ ...DEFAULT_REPORT_STATE, period: 'lastMonth' }, 5, TODAY).toString()).toBe('account=5&from=2026-09-01&to=2026-09-30');
    expect(statementExcelHref(1, DEFAULT_REPORT_STATE, 7, TODAY)).toBe('/api/v1/companies/1/analytics/statement.xlsx?account=7&from=2026-01-01&to=2026-12-31');
  });

  it('сводка сходится: конец = начало + поступления - списания + переводы на счёт - со счёта; знак суммы — по движению', () => {
    expect(statementSummary(1_500_000, { income: 100_000, expense: 30_000, transfersIn: 23_756, transfersOut: 47_512 }).end).toBe(1_546_244);
    expect(statementSummary(-500, { income: 0, expense: 0, transfersIn: 0, transfersOut: 0 })).toEqual({ start: -500, income: 0, expense: 0, transfersIn: 0, transfersOut: 0, end: -500 });
    expect(deltaMoney(-47_512, 'KZT').replace(/[\u00A0\u202F]/g, ' ')).toBe('\u2212475,12 ₸');
    expect(deltaMoney(100, 'USD').replace(/[\u00A0\u202F]/g, ' ')).toBe('+1 $');
    expect(deltaMoney(0, 'KZT').startsWith('+')).toBe(true);
  });
});
