import { and, asc, desc, eq, gte, inArray, isNull, lt, min, ne, notInArray } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { senetConnections, senetOffices, senetRaw, senetShifts, senetSyncRuns } from '../../db/schema';
import { withTx } from '../../db/tx';
import type { SenetSyncRunDto } from '../../../shared/schemas/senet';
import type { FileStore } from '../../files/store';
import { SecretsError } from '../../secrets';
import type { SenetConnections } from './connections';
import { SenetError, type RawFile, type ReportKind, type SenetSource } from './source';
import { markSpan, writeAnalyticsDay, writeOfficeBatch } from './store';
import { todayInTimezone } from '../../../shared/dates';
import { phoneMask, type Secrets } from '../../secrets';

export type SyncTrigger = 'hourly' | 'cron' | 'manual' | 'period';

export interface SyncResult {
  runId: number;
  connectionId: number;
  result: 'ok' | 'partial' | 'failed';
  counts: Record<string, number>;
  error: string | null;
  budgetExceeded: boolean;
}

export interface SenetSync {
  /** Забор: по всем неархивным подключениям (часовой — кроме key_rejected) или по одному подключению и клубу. */
  run(o: { companyId?: number; connectionId?: number; officeId?: number; trigger: SyncTrigger; from?: string; to?: string; deadline?: number }): Promise<SyncResult[]>;
  /** Подключения, которым нужен новый доступ, — для баннера «Обновите доступ к Senet». */
  status(companyId: number): Promise<{ rejected: { connectionId: number; name: string }[] }>;
  /** Ход и итог запуска; чужая компания — null. */
  getRun(companyId: number, runId: number): Promise<SenetSyncRunDto | null>;
  /** Идёт другой забор: незавершённый запуск моложе 10 минут (зависший старше — не мешает). */
  running(): Promise<boolean>;
}

/** Хук после записи смен клуба (автопроводка, задача 11) — в той же транзакции. */
export type AfterOfficeSync = (tx: Executor, officeId: number, until: string) => Promise<void>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CHUNK_MS = 7 * DAY;
const OVERLAP_MS = 26 * HOUR;
const RAW_KEEP_MS = 90 * DAY;
const RUNS_KEEP = 500;
const STALE_RUN_MS = 10 * 60_000;
/** Столько строк Senet отдаёт в отчёте самое большее (настоящие выгрузки: продажи за октябрь обрезаны на 2000). */
const SENET_ROW_CAP = 2000;
const OUT_OF_TIME = 'Не уложились во время — продолжим через час';
const NO_ENABLED = 'Ни один клуб не включён — забирать нечего. Включите клуб в «Изменить» или загрузите историю через «Загрузить за период»';

/** Ключ файла без «:» (локальное хранилище на Windows): 2026-10-01T04:00:00.000Z → 20261001T040000Z. */
const compact = (iso: string) => iso.replace(/[-:]|\.\d{3}/g, '');

/** Сырые файлы старше 90 дней (§9.2): ночная уборка; возвращает, сколько удалено. */
export async function cleanupSenetRaw(db: Db, files: FileStore, now: Date): Promise<number> {
  const old = await db.select({ id: senetRaw.id, fileKey: senetRaw.fileKey }).from(senetRaw).where(lt(senetRaw.fetchedAt, new Date(now.getTime() - RAW_KEEP_MS).toISOString()));
  for (const r of old) await files.remove(r.fileKey);
  if (old.length) await withTx(db, async (tx) => void (await tx.delete(senetRaw).where(inArray(senetRaw.id, old.map((r) => r.id)))));
  return old.length;
}

export function createSenetSync(d: {
  db: Db;
  connections: SenetConnections;
  files: FileStore;
  timezone: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  afterOffice?: AfterOfficeSync;
  /** Ключ HMAC телефонов гостей (§9.3); null — телефон хранится только маской. */
  secrets?: () => Secrets | null;
}): SenetSync {
  const { db, files } = d;
  const now = d.now ?? (() => new Date());

  async function saveRaw(connectionId: number, officeId: number, kind: ReportKind, from: string, to: string, raw: RawFile): Promise<boolean> {
    const dup = await first(db.select({ id: senetRaw.id }).from(senetRaw).where(and(eq(senetRaw.connectionId, connectionId), eq(senetRaw.sha256, raw.sha256))));
    if (dup) return false;
    const fileKey = `senet/raw/${connectionId}/${kind}/${compact(from)}_${compact(to)}_${raw.sha256.slice(0, 16)}.xlsx`;
    await files.put(fileKey, raw.data, raw.contentType || 'application/octet-stream');
    await withTx(db, async (tx) => {
      await tx
        .insert(senetRaw)
        .values({ connectionId, report: kind, officeId, fromDate: from, toDate: to, fetchedAt: now().toISOString(), status: 200, fileKey, sha256: raw.sha256 })
        .onConflictDoNothing();
    });
    return true;
  }

  /** Начало окна клуба (С15§5.2): самое раннее из «открытия незакрытой смены» и «последнего забора − 26 ч». */
  async function windowStart(office: typeof senetOffices.$inferSelect, lastSyncAt: string | null): Promise<string | null> {
    if (!lastSyncAt) return office.historyFrom;
    const open = await first(db.select({ v: min(senetShifts.openedAt) }).from(senetShifts).where(and(eq(senetShifts.officeId, office.id), isNull(senetShifts.closedAt))));
    const overlap = new Date(Date.parse(lastSyncAt) - OVERLAP_MS).toISOString();
    return open?.v && open.v < overlap ? open.v : overlap;
  }

  async function runConnection(
    conn: typeof senetConnections.$inferSelect,
    o: { officeId?: number; trigger: SyncTrigger; from?: string; to?: string; deadline?: number },
  ): Promise<SyncResult> {
    const startedAt = now().toISOString();
    const [run] = await db.insert(senetSyncRuns).values({ connectionId: conn.id, startedAt, trigger: o.trigger }).returning({ id: senetSyncRuns.id });
    const counts = { chunks: 0, done: 0, shifts: 0, moves: 0, files: 0 };
    let error: string | null = null;
    let partial = false;
    let failed = false;
    let budgetExceeded = false;
    let status: 'ok' | 'key_rejected' | 'unreachable' = conn.status;

    // «Загрузить за период» — и выключенные клубы: история до включения (§5.5); проводятся только включённые
    const offices = await db
      .select()
      .from(senetOffices)
      .where(
        and(
          eq(senetOffices.connectionId, conn.id),
          o.officeId ? eq(senetOffices.id, o.officeId) : o.trigger === 'period' ? undefined : eq(senetOffices.enabled, true),
        ),
      )
      .orderBy(asc(senetOffices.id));
    if (offices.length === 0) error = NO_ENABLED;

    let source: SenetSource | null = null;
    try {
      if (o.deadline !== undefined && Date.now() >= o.deadline) {
        budgetExceeded = true;
        throw new Error(OUT_OF_TIME);
      }
      source = await d.connections.sourceFor(conn.id);
      for (const office of offices) {
        const start = o.from ?? (await windowStart(office, conn.lastSyncAt));
        if (!start) continue;
        const end = o.to ?? now().toISOString();
        const chunks: [string, string][] = [];
        for (let t = Date.parse(start); t < Date.parse(end); t += CHUNK_MS) chunks.push([new Date(t).toISOString(), new Date(Math.min(t + CHUNK_MS, Date.parse(end))).toISOString()]);
        counts.chunks += chunks.length;
        for (const [from, to] of chunks) {
          if (o.deadline !== undefined && Date.now() >= o.deadline) {
            budgetExceeded = true;
            throw new Error(OUT_OF_TIME);
          }
          const ref = { officeId: office.senetOfficeId, cashDeskId: office.cashDeskId };
          const movesFrom = new Date(Date.parse(from) - DAY).toISOString();
          /** Отчёт отрезка; незнакомый формат — сырой файл сохраняется, отчёт считается не пришедшим. */
          const fetch = async <K extends ReportKind>(kind: K, f: string, t: string) => {
            try {
              const r = await source!.report(kind, ref, new Date(f), new Date(t));
              if (await saveRaw(conn.id, office.id, kind, f, t, r.raw)) counts.files++;
              return r.rows;
            } catch (e) {
              if (!(e instanceof SenetError) || e.code !== 'bad_format') throw e;
              if (e.raw && (await saveRaw(conn.id, office.id, kind, f, t, e.raw))) counts.files++;
              partial = true;
              error ??= e.message;
              return null;
            }
          };
          const sessions = await fetch('sessions', from, to);
          const moves = await fetch('cashMoves', movesFrom, to);
          const transactions = await fetch('transactions', from, to);
          if (!sessions || !moves) continue;
          await withTx(db, async (tx) => {
            const written = await writeOfficeBatch(tx, { officeId: office.id, sessions, moves, movesFrom, movesTo: to, transactions, txFrom: from, txTo: to }, now().toISOString());
            // покрытие данных (аналитика клуба, §3.2): отрезки принятых и записанных отчётов
            await markSpan(tx, office.id, 'sessions', from, to);
            await markSpan(tx, office.id, 'cashMoves', movesFrom, to);
            if (transactions) await markSpan(tx, office.id, 'transactions', from, to);
            counts.shifts += written.shifts;
            counts.moves += written.moves;
            if (d.afterOffice) await d.afterOffice(tx, office.id, to);
          });
          // продажи, чеки и пополнения — окнами по суткам: Senet обрезает отчёт продаж на 2000 строк (§9.3)
          const secrets = d.secrets?.() ?? null;
          const phone = (p: string | null) => (p ? { hash: secrets ? secrets.phoneHash(p) : null, mask: phoneMask(p) } : { hash: null, mask: null });
          for (let t = Date.parse(from); t < Date.parse(to); t += DAY) {
            const dayFrom = new Date(t).toISOString();
            const dayTo = new Date(Math.min(t + DAY, Date.parse(to))).toISOString();
            const sold = await fetch('soldItems', dayFrom, dayTo);
            const checks = await fetch('checks', dayFrom, dayTo);
            const refills = await fetch('refills', dayFrom, dayTo);
            const stock = await fetch('stock', dayFrom, dayTo);
            const goodsMoves = await fetch('goodsMoves', dayFrom, dayTo);
            const load = await fetch('load', dayFrom, dayTo);
            const tickets = await fetch('tickets', dayFrom, dayTo);
            for (const [kind, rows] of [['sold_check_items', sold], ['checks', checks], ['refill', refills], ['office_load_by_zones', load], ['tickets', tickets]] as const) {
              if (rows && rows.length === SENET_ROW_CAP) {
                partial = true;
                const [y, m, dd] = todayInTimezone(d.timezone, new Date(dayFrom)).split('-');
                error ??= `Отчёт «${kind}» за ${dd}.${m}.${y} пришёл ровно на ${SENET_ROW_CAP} строк — Senet мог его обрезать`;
              }
            }
            await withTx(db, async (tx) => {
              await writeAnalyticsDay(tx, { officeId: office.id, from: dayFrom, to: dayTo, sold, checks, refills, stock, goodsMoves, load, tickets, phone });
              const got = { soldItems: sold, checks, refills, stock, goodsMoves, load, tickets } as const;
              for (const [kind, rows] of Object.entries(got)) if (rows) await markSpan(tx, office.id, kind as ReportKind, dayFrom, dayTo);
            });
          }
          counts.done++;
        }
      }
    } catch (e) {
      if (budgetExceeded) {
        partial = true;
        error ??= OUT_OF_TIME;
      } else if (e instanceof SenetError) {
        failed = true;
        error = e.message;
        if (e.code === 'auth_rejected' || e.code === 'auth_needs_code') status = 'key_rejected';
        else if (e.code === 'unreachable' || e.code === 'server_error') status = 'unreachable';
      } else if (e instanceof SecretsError) {
        failed = true;
        error = e.message;
        status = 'key_rejected';
      } else throw e;
    }

    const result: SyncResult['result'] = failed ? 'failed' : partial ? 'partial' : 'ok';
    const finishedAt = now().toISOString();
    // окно часового забора сдвигается только полным забором до «сейчас»; «Загрузить за период» его не трогает
    const advance = !failed && !budgetExceeded && o.trigger !== 'period';
    await withTx(db, async (tx) => {
      await tx
        .update(senetSyncRuns)
        .set({ finishedAt, result, error, counts: JSON.stringify(counts) })
        .where(eq(senetSyncRuns.id, run!.id));
      await tx
        .update(senetConnections)
        .set({
          status: failed ? status : 'ok',
          lastError: failed ? error : null,
          ...(advance ? { lastSyncAt: finishedAt } : {}),
        })
        .where(eq(senetConnections.id, conn.id));
      const keep = await tx.select({ id: senetSyncRuns.id }).from(senetSyncRuns).where(eq(senetSyncRuns.connectionId, conn.id)).orderBy(desc(senetSyncRuns.id)).limit(RUNS_KEEP);
      await tx.delete(senetSyncRuns).where(and(eq(senetSyncRuns.connectionId, conn.id), notInArray(senetSyncRuns.id, keep.map((r) => r.id))));
    });
    return { runId: run!.id, connectionId: conn.id, result, counts, error, budgetExceeded };
  }

  return {
    async run(o) {
      const automatic = o.trigger === 'hourly' || o.trigger === 'cron';
      const conns = await db
        .select()
        .from(senetConnections)
        .where(
          and(
            isNull(senetConnections.archivedAt),
            o.connectionId ? eq(senetConnections.id, o.connectionId) : undefined,
            o.companyId ? eq(senetConnections.companyId, o.companyId) : undefined,
            automatic ? ne(senetConnections.status, 'key_rejected') : undefined,
          ),
        )
        .orderBy(asc(senetConnections.id));
      const out: SyncResult[] = [];
      // в каждый момент — один запрос: подключения по очереди (С15§5.1)
      for (const conn of conns) out.push(await runConnection(conn, o));
      return out;
    },
    async status(companyId) {
      const rows = await db
        .select({ connectionId: senetConnections.id, name: senetConnections.name })
        .from(senetConnections)
        .where(and(eq(senetConnections.companyId, companyId), eq(senetConnections.status, 'key_rejected'), isNull(senetConnections.archivedAt)))
        .orderBy(asc(senetConnections.id));
      return { rejected: rows };
    },
    async getRun(companyId, runId) {
      const row = await first(
        db
          .select({ run: senetSyncRuns })
          .from(senetSyncRuns)
          .innerJoin(senetConnections, eq(senetConnections.id, senetSyncRuns.connectionId))
          .where(and(eq(senetSyncRuns.id, runId), eq(senetConnections.companyId, companyId))),
      );
      return row ? { ...row.run, counts: JSON.parse(row.run.counts) as Record<string, number> } : null;
    },
    async running() {
      const since = new Date(now().getTime() - STALE_RUN_MS).toISOString();
      return Boolean(await first(db.select({ id: senetSyncRuns.id }).from(senetSyncRuns).where(and(isNull(senetSyncRuns.finishedAt), gte(senetSyncRuns.startedAt, since))).limit(1)));
    },
  };
}
