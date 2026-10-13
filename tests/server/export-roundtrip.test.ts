import { afterEach, describe, expect, it } from 'vitest';
import { checkImport, formatReport, isMatch } from '../../scripts/lib/import-check';
import { seedDemo } from '../../scripts/lib/demo';
import { nameKey } from '../../src/shared/finmap-format';
import type { AccountMapping } from '../../src/shared/schemas/imports';
import { createApi } from '../helpers/api';
import { importXlsx } from '../helpers/imports';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { sheetRows } from '../helpers/xlsx-rows';

/**
 * Круг (§12 шаг 7, §11.2 спецификации импорта): «Excel» из синтетической компании → импорт в новую компанию настоящим
 * кодом импорта (upload → preview → запись) → балансы счетов, итоги по категориям, даты и период начисления совпадают;
 * разбитая операция возвращается N операциями. Реальных данных нет: названия выдуманные.
 */

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const sqlite = () => w.h.t.sqlite;
const all = <T = Record<string, any>>(sql: string, ...args: unknown[]) => sqlite().prepare(sql).all(...args) as T[];
const one = <T = Record<string, any>>(sql: string, ...args: unknown[]) => sqlite().prepare(sql).get(...args) as T;
const base = (cid: number) => `/api/v1/companies/${cid}`;
const NOW = '2026-10-06T12:00:00.000Z';

/** Файл «Excel» компании по всему журналу (format=finmap). */
async function exportFile(cid: number, qs = 'format=finmap'): Promise<Buffer> {
  const res = await w.h.req('GET', `${base(cid)}/operations/export.xlsx?${qs}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.rawPayload;
}

/** Остатки счетов по названию (через API — то, что видит человек). */
async function balances(cid: number): Promise<Record<string, number>> {
  const res = await w.h.req('GET', `${base(cid)}/balances`);
  expect(res.statusCode, res.body).toBe(200);
  const names = new Map(all<{ id: number; name: string }>('SELECT id, name FROM accounts WHERE company_id = ?', cid).map((a) => [a.id, a.name]));
  return Object.fromEntries((res.json().accounts as { accountId: number; balance: number }[]).map((a) => [names.get(a.accountId)!, a.balance]));
}

/** Сопоставления для импорта: у каждого счёта источника — новый счёт с той же валютой и тем же стартовым балансом (честная проверка, не «Текущий остаток»). */
function newAccounts(cid: number): AccountMapping[] {
  return all<{ name: string; currency: string; start: number }>('SELECT name, currency, starting_balance AS start FROM accounts WHERE company_id = ?', cid).map((a) => ({
    key: nameKey(a.name),
    kind: 'new' as const,
    name: a.name,
    currency: a.currency,
    balance: { mode: 'start' as const, amount: a.start },
  }));
}

/** Итоги по (вид, категория или «Родитель → Подкатегория») в базовой валюте — по строкам операций. */
const categoryTotals = (cid: number) =>
  all(
    `SELECT o.type AS type, CASE WHEN pc.name IS NULL THEN COALESCE(c.name, '—') ELSE pc.name || ' → ' || c.name END AS category, SUM(l.base_amount) AS total
       FROM operation_lines l JOIN operations o ON o.id = l.operation_id
       LEFT JOIN categories c ON c.id = l.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
      WHERE o.company_id = ? AND o.deleted_at IS NULL AND o.type <> 'transfer'
      GROUP BY 1, 2 ORDER BY 1, 2`,
    cid,
  );

/** Итоги по проектам — так же. */
const projectTotals = (cid: number) =>
  all(
    `SELECT o.type AS type, COALESCE(p.name, '—') AS project, SUM(l.base_amount) AS total
       FROM operation_lines l JOIN operations o ON o.id = l.operation_id LEFT JOIN projects p ON p.id = l.project_id
      WHERE o.company_id = ? AND o.deleted_at IS NULL AND o.type <> 'transfer'
      GROUP BY 1, 2 ORDER BY 1, 2`,
    cid,
  );

/** Строка операции для сравнения до и после круга. */
interface SnapRow {
  comment: string | null;
  type: 'income' | 'expense' | 'transfer';
  paidAt: string;
  accrualDate: string | null;
  account: string;
  toAccount: string | null;
  toAmount: number | null;
  amount: number;
  baseAmount: number;
  counterparty: string | null;
  category: string | null;
  project: string | null;
  tags: string;
}

/** Операции по строкам: у разбитой — строка на строку (так она возвращается после круга), у остальных — одна. */
function lineSnapshot(cid: number): SnapRow[] {
  const tags = new Map<number, string[]>();
  for (const t of all<{ id: number; name: string }>(
    'SELECT ot.operation_id AS id, t.name AS name FROM operation_tags ot JOIN tags t ON t.id = ot.tag_id JOIN operations o ON o.id = ot.operation_id WHERE o.company_id = ?',
    cid,
  )) {
    tags.set(t.id, [...(tags.get(t.id) ?? []), t.name].sort());
  }
  return all<Omit<SnapRow, 'tags'> & { id: number }>(
    `SELECT o.id AS id, o.comment AS comment, o.type AS type, o.paid_at AS paidAt, o.accrual_date AS accrualDate, a.name AS account, ta.name AS toAccount,
            o.to_amount AS toAmount, CASE WHEN o.type = 'transfer' THEN o.amount ELSE l.amount END AS amount,
            CASE WHEN o.type = 'transfer' THEN o.base_amount ELSE l.base_amount END AS baseAmount, cp.name AS counterparty,
            CASE WHEN pc.name IS NULL THEN c.name ELSE pc.name || ' → ' || c.name END AS category, p.name AS project
       FROM operations o
       JOIN accounts a ON a.id = o.account_id
       LEFT JOIN accounts ta ON ta.id = o.to_account_id
       LEFT JOIN counterparties cp ON cp.id = o.counterparty_id
       LEFT JOIN operation_lines l ON l.operation_id = o.id
       LEFT JOIN categories c ON c.id = l.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN projects p ON p.id = l.project_id
      WHERE o.company_id = ? AND o.deleted_at IS NULL`,
    cid,
  )
    .map(({ id, ...row }) => ({ ...row, tags: (tags.get(id) ?? []).join(',') }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** Системная категория компании по ключу. */
async function systemCategory(cid: number, key: string): Promise<number> {
  const tree = (await w.h.req('GET', `${base(cid)}/categories`)).json() as { income: { id: number; systemKey: string | null }[]; expense: { id: number; systemKey: string | null }[] };
  return [...tree.income, ...tree.expense].find((c) => c.systemKey === key)!.id;
}

interface World {
  /** Число операций источника и число строк разбитых операций: после круга операций столько, сколько строк. */
  operations: number;
  expectedAfter: number;
}

/**
 * Источник: компания «ТОО» с тремя счетами в тенге (у «Банка-2» — стартовый остаток), «Валютным» в USD и «Иеной» (0 знаков).
 * Курсы — ручные: 475,12 за USD и 3,15 за JPY. Все суммы между валютами сходятся по курсу точно.
 */
async function sourceWorld(opts: { crossToForeign: boolean }): Promise<World> {
  w = await opsWorld(NOW);
  sqlite().prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('JPY','Иена','¥',0)").run();
  await w.post('/api/v1/rates/manual', { date: '2026-10-01', currency: 'JPY', rate: '3.15' });
  const b = base(w.cid);
  const bank = (await w.post(`${b}/accounts`, { name: 'Банк-2', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 250000 })).account.id as number;
  const yen = (await w.post(`${b}/accounts`, { name: 'Иена', currency: 'JPY', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
  const archive = (await w.post(`${b}/accounts`, { name: 'Архив', currency: 'KZT', openedAt: '2023-01-01', startingBalance: 0 })).account.id as number;
  const salary = await systemCategory(w.cid, 'salary');
  const tax = await systemCategory(w.cid, 'tax');
  const vat = await systemCategory(w.cid, 'vat');
  const staff = (await w.post(`${b}/categories`, { kind: 'expense', name: 'Администраторы', parentId: salary })).category.id as number;
  const link = (await w.post(`${b}/categories`, { kind: 'expense', name: 'Связь' })).category.id as number;
  const employee = (await w.post(`${b}/counterparties`, { type: 'employee', name: 'Сотрудник А' })).counterparty.id as number;
  const night = (await w.post(`${b}/tags`, { name: 'Ночь' })).tag.id as number;
  const op = (body: Record<string, unknown>) => w.post(w.ops, body);
  const line = (categoryId: number | null, amount: number, projectId: number | null = null) => ({ categoryId, projectId, amount });

  // доход, разбитый на два проекта; 30.09 — не первое число, дата начисления уходит в B
  await op({
    type: 'income', accountId: w.kzt, paidAt: '2026-10-05T05:00:00.000Z', amount: 150050, accrualDate: '2026-09-30', counterpartyId: w.counterparty,
    tagIds: [w.tag, night], comment: 'доход Бар', lines: [line(w.income, 100000, w.project), line(w.income, 50050, w.project2)],
  });
  // зарплата, налоги, НДС с датой начисления 1-го числа — период C/D; аренда с первым числом — обычная дата; зарплата с серединой месяца — тоже B
  await op({ type: 'expense', accountId: w.kzt, paidAt: '2026-10-02T10:00:00.000Z', amount: 850000, accrualDate: '2026-09-01', counterpartyId: employee, comment: 'зарплата за сентябрь', lines: [line(staff, 850000)] });
  await op({ type: 'expense', accountId: bank, paidAt: '2026-10-02T11:00:00.000Z', amount: 120000, accrualDate: '2026-08-01', comment: 'налог за август', lines: [line(tax, 120000)] });
  await op({ type: 'expense', accountId: bank, paidAt: '2026-10-02T12:00:00.000Z', amount: 33300, accrualDate: '2026-02-01', comment: 'НДС за февраль', lines: [line(vat, 33300)] });
  await op({ type: 'expense', accountId: w.kzt, paidAt: '2026-10-02T13:00:00.000Z', amount: 500000, accrualDate: '2026-09-01', comment: 'аренда за сентябрь', lines: [line(w.expense, 500000, w.project)] });
  await op({ type: 'expense', accountId: w.kzt, paidAt: '2026-10-02T14:00:00.000Z', amount: 700000, accrualDate: '2026-09-15', counterpartyId: employee, comment: 'зарплата, середина месяца', lines: [line(salary, 700000)] });
  // расход в USD, разбитый на две категории и проект: суммы строк в валюте счёта и в тенге — свои
  await op({
    type: 'expense', accountId: w.usd, paidAt: '2026-10-03T10:00:00.000Z', amount: 10000, comment: 'расход в долларах',
    lines: [line(w.expense, 6000, w.project), line(link, 4000)],
  });
  // расход в иенах: валюта без копеек
  await op({ type: 'expense', accountId: yen, paidAt: '2026-10-03T11:00:00.000Z', amount: 5000, comment: 'расход в иенах', lines: [line(link, 5000)] });
  // перевод USD → KZT: сумма зачисления — в базовой валюте, берётся из «Суммы в валюте компании»
  await op({ type: 'transfer', accountId: w.usd, toAccountId: w.kzt, paidAt: '2026-10-04T10:00:00.000Z', amount: 5000, toAmount: 2375600, comment: 'перевод в тенге', lines: [line(null, 5000, w.project2)] });
  // ночные операции на границе суток по Алматы: 23:30 4 октября и 00:30 5 октября
  await op({ type: 'income', accountId: bank, paidAt: '2026-10-04T18:30:00.000Z', amount: 111100, comment: 'вечер 23:30', lines: [line(w.income, 111100)] });
  await op({ type: 'income', accountId: bank, paidAt: '2026-10-04T19:30:00.000Z', amount: 222200, comment: 'ночь 00:30', lines: [line(w.income, 222200)] });
  // текст, который Excel мог бы принять за формулу, и длинный комментарий с переводом строки
  await op({ type: 'expense', accountId: w.kzt, paidAt: '2026-10-05T07:00:00.000Z', amount: 1000, comment: '=1+1', lines: [line(link, 1000)] });
  await op({ type: 'expense', accountId: w.kzt, paidAt: '2026-10-05T08:00:00.000Z', amount: 1000, comment: `${'д'.repeat(1500)}\r\n вторая строка`, lines: [line(link, 1000)] });
  // эпоха UTC+6 (до 01.03.2024): 17:30 UTC — это 23:30 по Алматы того же дня; дата и время должны вернуться теми же
  await op({ type: 'income', accountId: archive, paidAt: '2023-06-15T17:30:00.000Z', amount: 77700, comment: 'старый доход 23:30', lines: [line(w.income, 77700)] });
  let operations = 14;
  if (opts.crossToForeign) {
    // перевод KZT → USD: сумма зачисления восстанавливается по курсу (47 512,00 ₸ / 475,12 = 100,00 $)
    await op({ type: 'transfer', accountId: w.kzt, toAccountId: w.usd, paidAt: '2026-10-04T12:00:00.000Z', amount: 4751200, toAmount: 10000, comment: 'перевод в доллары', lines: [] });
    operations++;
  }
  // разбитых операций две (доход и расход в долларах): строк на 2 больше, чем операций
  return { operations, expectedAfter: operations + 2 };
}

describe('круг через «Excel»: компания → файл → новая компания (§12 шаг 7)', () => {
  it('балансы, итоги по категориям и проектам, даты и период, разбитые операции и перевод USD → KZT совпадают; import:check — «Совпадает»', async () => {
    const world = await sourceWorld({ crossToForeign: false });
    const file = await exportFile(w.cid);
    const rows = sheetRows(file);
    expect(rows).toHaveLength(1 + world.expectedAfter); // заголовок + строка на строку операции
    // период начисления — только у зарплаты, налога и НДС с первым числом месяца; остальное — в «Дате начисления»
    expect(rows.slice(1).filter((r) => r[2] !== '').map((r) => [r[15], r[2], r[3], r[1]])).toEqual(
      expect.arrayContaining([
        ['зарплата за сентябрь', '01.09.2026 00:00:00', '30.09.2026 23:59:59', ''],
        ['налог за август', '01.08.2026 00:00:00', '31.08.2026 23:59:59', ''],
        ['НДС за февраль', '01.02.2026 00:00:00', '28.02.2026 23:59:59', ''],
      ]),
    );
    expect(rows.slice(1).filter((r) => r[2] !== '')).toHaveLength(3);
    expect(rows.find((r) => r[15] === 'зарплата, середина месяца')![1]).toBe('46280'); // 15.09.2026
    expect(rows.find((r) => r[15] === 'аренда за сентябрь')![1]).toBe('46266'); // 01.09.2026 у несистемной категории — «Дата начисления»

    // в новую компанию: каждый счёт — новый, с тем же стартовым балансом (не «Текущий остаток»)
    const target = await w.h.company('ТОО Круг');
    const imported = await importXlsx(w, file, { cid: target, accounts: newAccounts(w.cid), name: 'круг.xlsx' });
    expect(imported.counts).toMatchObject({ rows: world.expectedAfter, added: world.expectedAfter, duplicates: 0, skippedFuture: 0 });

    // балансы счетов — до копейки, в том числе в иенах и долларах; число операций — по строкам разбитых
    expect(await balances(target)).toEqual(await balances(w.cid));
    expect(Object.keys(await balances(target)).sort()).toEqual(['Архив', 'Банк-2', 'Валютный', 'Иена', 'Касса']);
    expect(one('SELECT COUNT(*) n FROM operations WHERE company_id = ?', target).n).toBe(world.expectedAfter);
    // итоги по категориям (вид, категория, подкатегория) и по проектам — как в источнике
    expect(categoryTotals(target)).toEqual(categoryTotals(w.cid));
    expect(projectTotals(target)).toEqual(projectTotals(w.cid));
    expect(categoryTotals(target).some((r) => r.category === 'Зарплата → Администраторы')).toBe(true);
    // каждая строка источника — операция новой компании: те же момент, счета, суммы, категория, проект, контрагент, теги, комментарий и дата начисления
    expect(lineSnapshot(target)).toEqual(lineSnapshot(w.cid));
    // операция эпохи UTC+6: тот же момент (23:30 по Алматы 15.06.2023), в файле и после круга
    expect(one("SELECT paid_at p FROM operations WHERE company_id = ? AND comment = 'старый доход 23:30'", target).p).toBe('2023-06-15T17:30:00.000Z');
    expect(Number(rows.find((r) => r[15] === 'старый доход 23:30')![0])).toBeCloseTo(45092 + 23.5 / 24, 9); // 15.06.2023 23:30 в серийном числе Excel
    // справочники: системные категории компании подхвачены, а не созданы заново
    expect(one("SELECT COUNT(*) n FROM categories WHERE company_id = ? AND system_key = 'salary'", target).n).toBe(1);
    expect(one("SELECT c.name n, p.name parent FROM categories c JOIN categories p ON p.id = c.parent_id WHERE c.company_id = ? AND c.name = 'Администраторы'", target)).toEqual({ n: 'Администраторы', parent: 'Зарплата' });

    // import:check на новой компании: тот же файл сверяется независимо от кода записи
    const report = checkImport({ sqlite: sqlite(), companyId: target, data: file, fileName: 'круг.xlsx', timezone: 'Asia/Almaty', today: '2026-10-06' });
    expect(formatReport(report).at(-1)).toBe('Итог: Совпадает');
    expect(isMatch(report)).toBe(true);
  });
});

describe('круг: файл по фильтру и пустой файл', () => {
  it('выгрузка по фильтру переносит только выбранное; пустой фильтр даёт файл с одним заголовком, и импорт отказывает «В файле нет операций»', async () => {
    const world = await sourceWorld({ crossToForeign: false });
    const target = await w.h.company('ТОО Круг');
    // только расходы в долларах: две строки разбитой операции
    const usd = await exportFile(w.cid, `format=finmap&accountIds=${w.usd}&types=expense`);
    expect(sheetRows(usd).slice(1).map((r) => [r[4], r[5], r[8], r[12]])).toEqual([
      ['60.00', '28507.20', 'Аренда', 'Клуб 1'],
      ['40.00', '19004.80', 'Связь', ''],
    ]);
    const mapping = newAccounts(w.cid).filter((a) => a.kind === 'new' && a.name === 'Валютный');
    expect((await importXlsx(w, usd, { cid: target, accounts: mapping, name: 'доллары.xlsx' })).counts.added).toBe(2);
    expect(Object.keys(await balances(target))).toEqual(['Валютный']);
    expect((await balances(target))['Валютный']).toBe(-10000);
    expect(world.operations).toBe(14);

    const empty = await exportFile(w.cid, 'format=finmap&q=нет такого');
    expect(sheetRows(empty)).toHaveLength(1);
    await expect(importXlsx(w, empty, { cid: await w.h.company('ТОО Пустая'), name: 'пусто.xlsx' })).rejects.toThrow('В файле нет операций');
  });
});

describe('круг: перевод между валютами (§4.2, §8.2)', () => {
  it('KZT → USD по курсу: сумма зачисления восстанавливается точно, балансы и строки совпадают; import:check называет такой счёт несверенным, а не расхождением', async () => {
    const world = await sourceWorld({ crossToForeign: true });
    const file = await exportFile(w.cid);
    const rows = sheetRows(file);
    // в файле — только сумма списания в валюте «Со счета»; суммы зачисления в формате Finmap нет
    const transfer = rows.find((r) => r[15] === 'перевод в доллары')!;
    expect([transfer[4], transfer[5], transfer[6], transfer[7]]).toEqual(['47512.00', '47512.00', 'Касса', 'Валютный']);
    const target = await w.h.company('ТОО Круг');
    await importXlsx(w, file, { cid: target, accounts: newAccounts(w.cid), name: 'круг.xlsx' });
    expect(one('SELECT COUNT(*) n FROM operations WHERE company_id = ?', target).n).toBe(world.expectedAfter);
    expect(await balances(target)).toEqual(await balances(w.cid));
    expect(lineSnapshot(target)).toEqual(lineSnapshot(w.cid));
    expect(categoryTotals(target)).toEqual(categoryTotals(w.cid));
    // import:check не может проверить зачисление в долларах по файлу (оно считается по курсам): «Не сверено» без ложного расхождения
    const report = checkImport({ sqlite: sqlite(), companyId: target, data: file, fileName: 'круг.xlsx', timezone: 'Asia/Almaty', today: '2026-10-06' });
    expect(report.mismatches).toBe(0);
    expect(report.accounts.find((a) => a.what === 'Валютный, USD')?.unverified).toBe(true);
    expect(report.notes).toContain('Движение этих счетов не сверялось: Валютный');
    expect(formatReport(report).at(-1)).toBe('Итог: Не сверено: 1 — см. «Внимание»');
    expect(isMatch(report)).toBe(false);
  });

  it('сумма зачисления, введённая не по курсу, после круга пересчитывается по курсу — остаток счёта зачисления отличается на курсовую разницу', async () => {
    w = await opsWorld(NOW);
    // 47 512,00 ₸ по курсу 475,12 — это 100,00 $, а человек записал, что пришло 99,00 $ (комиссия банка)
    await w.post(w.ops, { type: 'transfer', accountId: w.kzt, toAccountId: w.usd, paidAt: '2026-10-04T12:00:00.000Z', amount: 4751200, toAmount: 9900, comment: 'с комиссией', lines: [] });
    const file = await exportFile(w.cid);
    const target = await w.h.company('ТОО Круг');
    await importXlsx(w, file, { cid: target, accounts: newAccounts(w.cid), name: 'круг.xlsx' });
    const credited = (cid: number) => one('SELECT to_amount n FROM operations WHERE company_id = ?', cid).n;
    expect(credited(w.cid)).toBe(9900);
    expect(credited(target)).toBe(10000);
    expect((await balances(w.cid))['Валютный']).toBe(9900);
    expect((await balances(target))['Валютный']).toBe(10000);
    expect((await balances(target))['Касса']).toBe((await balances(w.cid))['Касса']);
  });
});

describe('круг на демо-наборе (§11.2)', () => {
  it('демо-компания → «Excel» → новая компания: операций столько, сколько строк; балансы счетов в базовой валюте и итоги по категориям совпадают', async () => {
    const h = await createApi(NOW);
    seedDemo({ db: h.t.db, timezone: 'Asia/Almaty', now: new Date(NOW), operations: 300 });
    w = { h } as OpsWorld;
    const source = (h.t.sqlite.prepare('SELECT id FROM companies ORDER BY id LIMIT 1').get() as { id: number }).id;
    const file = await exportFile(source);
    const rows = sheetRows(file);
    const target = await h.company('ТОО Круг демо');
    const imported = await importXlsx({ h, cid: target } as OpsWorld, file, { cid: target, accounts: newAccounts(source), name: 'демо.xlsx' });
    expect(imported.counts.added).toBe(rows.length - 1);
    expect(imported.counts.duplicates).toBe(0);
    expect(one('SELECT COUNT(*) n FROM operations WHERE company_id = ?', target).n).toBe(rows.length - 1);
    expect(categoryTotals(target)).toEqual(categoryTotals(source));
    expect(projectTotals(target)).toEqual(projectTotals(source));
    // балансы совпадают у всех счетов, кроме получателей переводов между валютами: сумма зачисления из файла не восстанавливается
    // (в формате Finmap её нет), а считается по нашим курсам — разница ровно в сумме этих пересчётов (§8.2)
    const key = (r: SnapRow) => `${r.paidAt}|${r.account}|${r.toAccount}|${r.amount}`;
    const credited = (cid: number) => new Map(lineSnapshot(cid).filter((r) => r.type === 'transfer').map((r) => [key(r), r]));
    const before = credited(source);
    const after = credited(target);
    expect(after.size).toBe(before.size);
    const delta: Record<string, number> = {};
    for (const [k, r] of before) {
      const moved = after.get(k)!;
      expect(moved, k).toBeDefined();
      delta[r.toAccount!] = (delta[r.toAccount!] ?? 0) + (moved.toAmount! - r.toAmount!);
    }
    const a = await balances(source);
    const b = await balances(target);
    for (const name of Object.keys(a)) expect(b[name], name).toBe(a[name]! + (delta[name] ?? 0));
    // переводы между валютами в демо-наборе есть, и хотя бы у одного пересчёт отличается: проверка не пустая
    expect(Object.values(delta).some((d) => d !== 0)).toBe(true);
  });
});
