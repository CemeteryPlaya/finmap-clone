import zlib from 'node:zlib';
import { getTableColumns, sql } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Db } from '../../db/client';
import { exec, one } from '../../db/raw';
import { boundTables, currentDialect, sqliteTables } from '../../db/schema';
import { withTx } from '../../db/tx';

/**
 * Вся база в один JSON.gz и обратно (план 2026-10-20-vercel-postgres, задачи 16 и 17): бэкап Postgres на Vercel
 * (ежедневное задание) и перенос SQLite → Postgres. Не зависит от диалекта: строки — как их отдаёт Drizzle (свойства
 * таблиц, числа, булевы, ISO-даты текстом), таблицы — по внешним ключам, строки таблицы со ссылкой на себя — родители
 * раньше детей.
 */
export const DUMP_FORMAT = 'finmap-clone-dump';

type TableKey = keyof typeof sqliteTables;
type Row = Record<string, unknown>;

interface Dump {
  format: typeof DUMP_FORMAT;
  version: 1;
  createdAt: string;
  tables: Partial<Record<TableKey, Row[]>>;
}

interface TablePlan {
  key: TableKey;
  name: string;
  /** Свойства-ссылки на эту же таблицу (categories.parentId). */
  selfRefs: string[];
  hasId: boolean;
}

/** Таблицы в порядке внешних ключей: сначала те, на которые ссылаются (по SQLite-схеме — имена в Postgres те же, Р4). */
function tablePlan(): TablePlan[] {
  const infos = (Object.keys(sqliteTables) as TableKey[]).map((key) => {
    const table = sqliteTables[key] as SQLiteTable;
    const cfg = getTableConfig(table);
    const propOf = Object.fromEntries(Object.entries(getTableColumns(table)).map(([prop, col]) => [col.name, prop]));
    const deps = new Set<string>();
    const selfRefs: string[] = [];
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const target = getTableConfig(ref.foreignTable).name;
      if (target === cfg.name) selfRefs.push(...ref.columns.map((c) => propOf[c.name]!));
      else deps.add(target);
    }
    return { key, name: cfg.name, deps, selfRefs, hasId: 'id' in propOf };
  });
  const out: TablePlan[] = [];
  const done = new Set<string>();
  while (out.length < infos.length) {
    const ready = infos.filter((i) => !done.has(i.name) && [...i.deps].every((d) => done.has(d)));
    if (ready.length === 0) throw new Error('Выгрузка базы: циклические внешние ключи между таблицами');
    for (const i of ready) {
      done.add(i.name);
      out.push({ key: i.key, name: i.name, selfRefs: i.selfRefs, hasId: i.hasId });
    }
  }
  return out;
}

/** Строки таблицы со ссылкой на себя: родитель раньше ребёнка. */
function parentsFirst(rows: Row[], selfRefs: string[]): Row[] {
  if (selfRefs.length === 0) return rows;
  const placed = new Set<unknown>();
  const out: Row[] = [];
  let rest = rows;
  while (rest.length > 0) {
    const next = rest.filter((r) => selfRefs.every((p) => r[p] === null || r[p] === undefined || placed.has(r[p])));
    if (next.length === 0) throw new Error('Выгрузка базы: строки ссылаются друг на друга по кругу');
    for (const r of next) placed.add(r.id);
    out.push(...next);
    rest = rest.filter((r) => !next.includes(r));
  }
  return out;
}

export async function dumpDatabase(db: Db, now = new Date()): Promise<Buffer> {
  const tables = boundTables();
  const dump: Dump = { format: DUMP_FORMAT, version: 1, createdAt: now.toISOString(), tables: {} };
  // одной транзакцией: согласованный снимок всех таблиц
  await withTx(db, async (tx) => {
    for (const p of tablePlan()) {
      const rows = (await tx.select().from(tables[p.key] as SQLiteTable)) as Row[];
      if (p.hasId) rows.sort((a, b) => Number(a.id) - Number(b.id));
      dump.tables[p.key] = rows;
    }
  });
  return zlib.gzipSync(JSON.stringify(dump));
}

function readDump(data: Buffer): Dump {
  try {
    const parsed = JSON.parse(zlib.gunzipSync(data).toString('utf8')) as Partial<Dump>;
    if (parsed.format === DUMP_FORMAT && parsed.version === 1 && parsed.tables && typeof parsed.tables === 'object') return parsed as Dump;
  } catch {
    /* ниже — общий отказ */
  }
  throw new Error('Это не выгрузка базы finmap-clone (файл .json.gz из ежедневного бэкапа)');
}

/** Строк в одном INSERT: в пределах числа параметров запроса SQLite и Postgres. */
const CHUNK = 500;

/**
 * Загрузка выгрузки одной транзакцией: все таблицы очищаются и заполняются строками выгрузки; у Postgres счётчики id
 * сдвигаются за наибольший id. В базу с компаниями или пользователями — только с force (замена всех данных).
 */
export async function restoreDatabase(db: Db, data: Buffer, opts: { force?: boolean } = {}): Promise<{ tables: number; rows: number }> {
  const dump = readDump(data);
  const known = new Set<string>(Object.keys(sqliteTables));
  const unknown = Object.keys(dump.tables).filter((k) => !known.has(k));
  if (unknown.length > 0) throw new Error(`В выгрузке таблицы, которых нет в этой версии: ${unknown.join(', ')}`);
  const tables = boundTables();
  const plan = tablePlan();
  return withTx(db, async (tx) => {
    if (!opts.force) {
      const used = await one<{ n: number }>(tx, sql`SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM companies) AS n`);
      if (Number(used?.n ?? 0) > 0) throw new Error('База не пустая: загрузка заменит все её данные — запустите с --force, если это и нужно');
    }
    for (const p of [...plan].reverse()) await tx.delete(tables[p.key] as SQLiteTable);
    let total = 0;
    for (const p of plan) {
      const rows = parentsFirst(dump.tables[p.key] ?? [], p.selfRefs);
      for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(tables[p.key] as SQLiteTable).values(rows.slice(i, i + CHUNK) as never);
      total += rows.length;
      // SQLite двигает счётчик AUTOINCREMENT сам; у Postgres identity — свой счётчик (у таблиц без него — NULL, без эффекта)
      if (p.hasId && currentDialect() === 'pg') {
        await exec(tx, sql`SELECT setval(pg_get_serial_sequence(${`"${p.name}"`}, 'id'), COALESCE((SELECT MAX(id) FROM ${sql.identifier(p.name)}), 0) + 1, false)`);
      }
    }
    return { tables: plan.length, rows: total };
  });
}
