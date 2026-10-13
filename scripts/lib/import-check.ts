import { getCurrency, isKnownCurrency } from '../../src/shared/currencies';
import { formatDateRu } from '../../src/shared/dates';
import { nameKey, systemKeyOf } from '../../src/shared/finmap-format';
import { formatAmount } from '../../src/shared/money';
import type { Sqlite } from '../../src/server/db/client';
import { decimalToMinor, parseSheet } from '../../src/server/modules/imports/parse-row';
import { readImportFile } from '../../src/server/modules/imports/read-file';

/**
 * Сверка импорта (§12 спецификации импорта): файл читается тем же разборщиком, а база — только запросами SELECT.
 * Движение счетов и итоги по категориям считаются по файлу независимо от кода записи и сравниваются с агрегатами
 * по неудалённым фактическим операциям компании. Плановые строки (дата в будущем) пропускаются, как при импорте;
 * дубликаты, пропущенные импортом, уже есть в компании — сверка их видит в базе.
 */

export interface CheckLine {
  /** Подпись строки: «доходы», «Касса, KZT», «Расходы: Зарплата → Администраторы». */
  what: string;
  file: number;
  db: number;
  /** Валюта сумм; null — это число операций. */
  currency: string | null;
}

export interface CheckReport {
  company: string;
  fileName: string;
  /** «Сегодня» разбора: строки позже — плановые и не считаются. */
  today: string;
  rows: { total: number; future: number; errors: number };
  counts: CheckLine[];
  accounts: CheckLine[];
  /** Итоги по категориям — в базовой валюте компании. */
  categories: CheckLine[];
  /** Что не сверялось и почему. */
  notes: string[];
  mismatches: number;
}

interface AccountRow {
  id: number;
  name: string;
  currency: string;
}

const units = (currency: string) => (isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2);
const KIND_TITLE = { income: 'Доходы', expense: 'Расходы' } as const;

/** Ключ итога по категории: системная — по systemKey, иначе по nameKey листа (подкатегории, а без неё — категории). */
function categoryKey(kind: 'income' | 'expense', leaf: string | null, systemKey: string | null): string {
  if (leaf === null) return `${kind}|—`;
  return systemKey ? `${kind}|sys:${systemKey}` : `${kind}|${nameKey(leaf)}`;
}

export function checkImport(input: { sqlite: Sqlite; companyId: number; data: Buffer; fileName: string; timezone: string; today: string }): CheckReport {
  const { sqlite, companyId } = input;
  const company = sqlite.prepare('SELECT name, base_currency AS base FROM companies WHERE id = ?').get(companyId) as { name: string; base: string } | undefined;
  if (!company) throw new Error(`Компании с id ${companyId} нет`);
  const parsed = parseSheet(readImportFile(input.data, input.fileName), { timezone: input.timezone, baseCurrency: company.base, today: input.today });
  const accounts = sqlite.prepare('SELECT id, name, currency FROM accounts WHERE company_id = ? ORDER BY order_index, id').all(companyId) as AccountRow[];
  const byKey = new Map<string, AccountRow>();
  for (const a of accounts) if (!byKey.has(nameKey(a.name))) byKey.set(nameKey(a.name), a);
  const notes: string[] = [];
  const missing = new Set<string>();

  // ——— файл
  const fileCounts = { income: 0, expense: 0, transfer: 0 };
  const fileMove = new Map<number, number>();
  /** Итоги по ключу листа; titles — подписи «Родитель → Подкатегория» всех строк с этим ключом. */
  const fileCats = new Map<string, { kind: 'income' | 'expense'; titles: Set<string>; sum: number }>();
  let crossSkipped = 0;
  let baseSkipped = 0;
  const move = (id: number, delta: number) => fileMove.set(id, (fileMove.get(id) ?? 0) + delta);
  for (const r of parsed.rows) {
    fileCounts[r.type]++;
    const acc = byKey.get(r.account.key);
    if (!acc) {
      missing.add(r.account.name);
      continue;
    }
    const amount = decimalToMinor(r.amount, units(acc.currency))?.minor ?? 0;
    move(acc.id, r.type === 'income' ? amount : -amount);
    if (r.type === 'transfer' && r.toAccount) {
      const to = byKey.get(r.toAccount.key);
      if (!to) missing.add(r.toAccount.name);
      else if (to.currency === acc.currency) move(to.id, amount);
      else if (to.currency === company.base && r.baseAmount !== null) move(to.id, r.baseAmount);
      else crossSkipped++;
      continue;
    }
    if (r.type === 'transfer') continue;
    // итоги по категориям — в валюте компании: у счёта в базовой валюте — сумма счёта, иначе «Сумма в валюте компании»
    const base = acc.currency === company.base ? amount : r.baseAmount;
    if (base === null) {
      baseSkipped++;
      continue;
    }
    const kind = r.type;
    const leaf = r.subcategory ?? r.category;
    const key = categoryKey(kind, leaf, r.subcategory ? null : r.category ? systemKeyOf(r.category, kind) : null);
    const c = fileCats.get(key) ?? { kind, titles: new Set<string>(), sum: 0 };
    c.titles.add(r.category ? (r.subcategory ? `${r.category} → ${r.subcategory}` : r.category) : 'Без категории');
    c.sum += kind === 'income' ? base : -base;
    fileCats.set(key, c);
  }
  if (missing.size) notes.push(`Нет счёта в компании для: ${[...missing].join(', ')} — их строки не сверялись`);
  if (crossSkipped) notes.push(`Переводов между валютами без суммы в валюте компании: ${crossSkipped} — сумма зачисления не сверялась`);
  if (baseSkipped) notes.push(`Строк на счетах не в валюте компании без «Суммы в валюте компании»: ${baseSkipped} — в итогах по категориям не учтены`);

  // ——— база: неудалённые фактические операции компании
  const live = "company_id = ? AND deleted_at IS NULL AND status = 'actual'";
  const dbCounts = Object.fromEntries(
    (sqlite.prepare(`SELECT type, COUNT(*) n FROM operations WHERE ${live} GROUP BY type`).all(companyId) as { type: string; n: number }[]).map((r) => [r.type, r.n]),
  );
  const dbMove = new Map<number, number>();
  const moves = sqlite
    .prepare(
      `SELECT account_id AS id, SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS m FROM operations WHERE ${live} GROUP BY account_id
       UNION ALL
       SELECT to_account_id AS id, SUM(to_amount) AS m FROM operations WHERE ${live} AND type = 'transfer' GROUP BY to_account_id`,
    )
    .all(companyId, companyId) as { id: number; m: number }[];
  for (const r of moves) dbMove.set(r.id, (dbMove.get(r.id) ?? 0) + r.m);
  const dbCats = new Map<string, { kind: 'income' | 'expense'; titles: Set<string>; sum: number }>();
  const lines = sqlite
    .prepare(
      `SELECT o.type AS kind, c.name AS name, c.system_key AS systemKey, p.name AS parent, SUM(l.base_amount) AS sum
         FROM operations o JOIN operation_lines l ON l.operation_id = o.id
         LEFT JOIN categories c ON c.id = l.category_id LEFT JOIN categories p ON p.id = c.parent_id
        WHERE o.company_id = ? AND o.deleted_at IS NULL AND o.status = 'actual' AND o.type <> 'transfer'
        GROUP BY o.type, l.category_id`,
    )
    .all(companyId) as { kind: 'income' | 'expense'; name: string | null; systemKey: string | null; parent: string | null; sum: number }[];
  for (const r of lines) {
    const key = categoryKey(r.kind, r.name, r.systemKey);
    const c = dbCats.get(key) ?? { kind: r.kind, titles: new Set<string>(), sum: 0 };
    c.titles.add(r.name === null ? 'Без категории' : r.parent ? `${r.parent} → ${r.name}` : r.name);
    c.sum += r.kind === 'income' ? r.sum : -r.sum;
    dbCats.set(key, c);
  }

  // ——— сравнение
  const counts: CheckLine[] = (['income', 'expense', 'transfer'] as const).map((t) => ({
    what: { income: 'доходы', expense: 'расходы', transfer: 'переводы' }[t],
    file: fileCounts[t],
    db: dbCounts[t] ?? 0,
    currency: null,
  }));
  const accountLines: CheckLine[] = accounts
    .filter((a) => fileMove.has(a.id) || dbMove.has(a.id))
    .map((a) => ({ what: `${a.name}, ${a.currency}`, file: fileMove.get(a.id) ?? 0, db: dbMove.get(a.id) ?? 0, currency: a.currency }));
  // подпись — по базе (там известен родитель), иначе по файлу; одноимённые подкатегории разных родителей сверяются вместе,
  // и в подписи видны все родители: «Расходы: Зарплата → Администраторы + Офис → Администраторы»
  const label = (k: string) => {
    const c = (dbCats.get(k) ?? fileCats.get(k))!;
    return `${KIND_TITLE[c.kind]}: ${[...c.titles].sort((a, b) => a.localeCompare(b, 'ru')).join(' + ')}`;
  };
  const catLines: CheckLine[] = [...new Set([...fileCats.keys(), ...dbCats.keys()])]
    .map((k) => ({ what: label(k), file: fileCats.get(k)?.sum ?? 0, db: dbCats.get(k)?.sum ?? 0, currency: company.base }))
    .sort((a, b) => a.what.localeCompare(b.what, 'ru'));
  const mismatches = [...counts, ...accountLines, ...catLines].filter((l) => l.file !== l.db).length;
  return {
    company: company.name,
    fileName: input.fileName,
    today: input.today,
    rows: { total: parsed.total, future: parsed.future.length, errors: new Set(parsed.issues.filter((i) => i.code.startsWith('R')).map((i) => i.row)).size },
    counts,
    accounts: accountLines,
    categories: catLines,
    notes,
    mismatches,
  };
}

/** Таблица «файл | база | разница» и итог «Совпадает» или «Расхождений: N». */
export function formatReport(r: CheckReport): string[] {
  const value = (n: number, currency: string | null) => (currency === null ? formatAmount(n, 0) : formatAmount(n, units(currency)));
  const table = (title: string, lines: CheckLine[]) => [
    '',
    title,
    `${'  '.padEnd(46)}${'файл'.padStart(18)}${'база'.padStart(18)}${'разница'.padStart(18)}`,
    ...lines.flatMap((l) => {
      const mark = l.file === l.db ? '  ' : '≠ ';
      const numbers = `${value(l.file, l.currency).padStart(18)}${value(l.db, l.currency).padStart(18)}${value(l.file - l.db, l.currency).padStart(18)}`;
      // длинная подпись не обрезается (в ней родители одноимённых подкатегорий): числа — строкой ниже
      return l.what.length > 44 ? [`${mark}${l.what}`, `${' '.repeat(46)}${numbers}`] : [`${mark}${l.what.padEnd(44)}${numbers}`];
    }),
  ];
  return [
    `Сверка импорта: файл «${r.fileName}», компания «${r.company}»`,
    `Сегодня для разбора: ${formatDateRu(r.today)} — строки с датой платежа позже пропущены как плановые (--today ГГГГ-ММ-ДД — другая дата)`,
    `Строк данных в файле: ${formatAmount(r.rows.total, 0)}; плановых пропущено: ${formatAmount(r.rows.future, 0)}; строк с ошибками: ${formatAmount(r.rows.errors, 0)}`,
    ...table('Операции, штук', r.counts),
    ...table('Движение по счетам (поступления минус списания), в валюте счёта', r.accounts),
    ...table('Итоги по категориям (доходы плюс, расходы минус), в валюте компании', r.categories),
    ...(r.notes.length ? ['', ...r.notes.map((n) => `Внимание: ${n}`)] : []),
    '',
    r.mismatches === 0 ? 'Итог: Совпадает' : `Итог: Расхождений: ${r.mismatches}`,
  ];
}
