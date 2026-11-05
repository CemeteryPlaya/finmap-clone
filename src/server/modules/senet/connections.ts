import { and, asc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';
import type {
  SenetCheckInput,
  SenetCheckResult,
  SenetConnectionCreateInput,
  SenetConnectionDto,
  SenetConnectionPatchInput,
  SenetOfficeDto,
  SenetOfficeInput,
} from '../../../shared/schemas/senet';
import type { Config } from '../../config';
import type { Db, Executor } from '../../db/client';
import { first } from '../../db/raw';
import { accounts, categories, projects, senetBarPurchases, senetCashMoves, senetChecks, senetConnections, senetDataSpans, senetGoodsMoves, senetLoad, senetOffices, senetPostings, senetRaw, senetRefills, senetReviewItems, senetRules, senetShifts, senetSoldItems, senetStock, senetSyncRuns, senetTickets, senetTransactions, senetZones } from '../../db/schema';
import { withTx } from '../../db/tx';
import { AppError } from '../../errors';
import type { Secrets } from '../../secrets';
import { SecretsError } from '../../secrets';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { createAdminTokenSource, type AdminCredentials } from './admin-source';
import { SenetError, type SenetSource } from './source';

type ConnectionRow = typeof senetConnections.$inferSelect;
type OfficeRow = typeof senetOffices.$inferSelect;

export interface SenetConnections {
  list(companyId: number): Promise<SenetConnectionDto[]>;
  check(companyId: number, input: SenetCheckInput): Promise<SenetCheckResult>;
  create(companyId: number, input: SenetConnectionCreateInput, userId: number): Promise<SenetConnectionDto>;
  update(companyId: number, id: number, patch: SenetConnectionPatchInput, userId: number): Promise<SenetConnectionDto>;
  remove(companyId: number, id: number, userId: number): Promise<void>;
  createOffice(companyId: number, connectionId: number, input: SenetOfficeInput, userId: number): Promise<SenetOfficeDto>;
  updateOffice(companyId: number, officeId: number, input: SenetOfficeInput, userId: number): Promise<SenetOfficeDto>;
  /** Источник подключения для забора; новый токен после входа сохраняется в подключении. */
  sourceFor(connectionId: number): Promise<SenetSource>;
}

/** Обезличенные слова типов по умолчанию (П2 плана): категории и контрагентов задаёт владелец. */
const DEFAULT_RULES: { type: (typeof senetRules.$inferInsert)['type']; pattern: string; match: (typeof senetRules.$inferInsert)['match']; flags?: object }[] = [
  { type: 'kaspi', pattern: 'kaspi', match: 'phrase' },
  { type: 'kaspi', pattern: 'каспи', match: 'phrase' },
  { type: 'salary_word', pattern: 'zp', match: 'word' },
  { type: 'salary_word', pattern: 'зп', match: 'word' },
  { type: 'salary_word', pattern: 'зарплата', match: 'first' },
  { type: 'salary_word', pattern: 'аванс', match: 'first' },
  { type: 'extra_pay_word', pattern: 'dop', match: 'word' },
  { type: 'extra_pay_word', pattern: 'доп', match: 'word' },
  { type: 'trainee', pattern: 'stajer', match: 'contains' },
  { type: 'trainee', pattern: 'stazher', match: 'contains' },
  { type: 'trainee', pattern: 'стажер', match: 'contains' },
  { type: 'lunch', pattern: 'obed', match: 'first' },
  { type: 'lunch', pattern: 'обед', match: 'first' },
  { type: 'lunch', pattern: 'еда', match: 'first' },
  { type: 'bar_item', pattern: 'brak', match: 'contains', flags: { defect: true } },
  { type: 'bar_item', pattern: 'брак', match: 'contains', flags: { defect: true } },
];

/** Слова по умолчанию — один раз на компанию: второе подключение их не дублирует. */
export async function seedDefaultRules(tx: Executor, companyId: number, userId: number, at: string): Promise<void> {
  const any = await first(tx.select({ id: senetRules.id }).from(senetRules).where(eq(senetRules.companyId, companyId)).limit(1));
  if (any) return;
  await tx.insert(senetRules).values(
    DEFAULT_RULES.map((r, i) => ({ companyId, type: r.type, pattern: r.pattern, match: r.match, priority: i, flags: JSON.stringify(r.flags ?? {}), createdAt: at, createdBy: userId })),
  );
}

const credentialsOf = (v: { authMethod: 'password' | 'token'; username: string; password: string; token: string }): AdminCredentials =>
  v.authMethod === 'password' ? { username: v.username, password: v.password } : { token: v.token };

const hintOf = (method: 'password' | 'token', c: AdminCredentials) => (method === 'password' ? c.username! : `••••${c.token!.slice(-4)}`);

const officeDto = (o: OfficeRow): SenetOfficeDto => ({
  id: o.id,
  senetOfficeId: o.senetOfficeId,
  cashDeskId: o.cashDeskId,
  name: o.name,
  enabled: o.enabled,
  projectId: o.projectId,
  cashAccountId: o.cashAccountId,
  kaspiAccountId: o.kaspiAccountId,
  incomeCategoryId: o.incomeCategoryId,
  historyFrom: o.historyFrom,
  cashOffset: o.cashOffset,
});

/** SenetError — понятный текст §11 для окна подключения. */
function asAppError(e: unknown): never {
  if (e instanceof SenetError) throw new AppError(422, 'SENET_' + e.code.toUpperCase(), e.message);
  throw e;
}

export function createSenetConnections(d: {
  db: Db;
  audit: AuditService;
  config: Config;
  /** Ключ шифрования; create — создать файл ключа, если его нет (локально). null — ключа нет (Vercel без SECRET_KEY). */
  secrets: (create: boolean) => Secrets | null;
  now?: () => Date;
  fetch?: typeof fetch;
}): SenetConnections {
  const { db, audit, config } = d;
  const now = d.now ?? (() => new Date());

  const sourceOf = (org: string, credentials: AdminCredentials, onToken?: (t: string) => Promise<void>) =>
    createAdminTokenSource({ org, credentials, timezone: config.timezone, base: config.senetApiBase ?? undefined, fetch: d.fetch, onToken });

  function requireSecrets(create: boolean): Secrets {
    const s = d.secrets(create);
    if (!s) throw new AppError(422, 'SECRET_KEY_MISSING', 'Задайте SECRET_KEY в настройках Vercel');
    return s;
  }

  async function requireConnection(ex: Executor, companyId: number, id: number): Promise<ConnectionRow> {
    const row = await first(ex.select().from(senetConnections).where(and(eq(senetConnections.id, id), eq(senetConnections.companyId, companyId))));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Подключение Senet не найдено');
    return row;
  }

  async function dto(ex: Executor, row: ConnectionRow): Promise<SenetConnectionDto> {
    const offices = await ex.select().from(senetOffices).where(eq(senetOffices.connectionId, row.id)).orderBy(asc(senetOffices.id));
    return {
      id: row.id,
      name: row.name,
      org: row.org,
      source: row.source,
      authMethod: row.authMethod,
      credentialsHint: row.credentialsHint,
      status: row.status,
      lastSyncAt: row.lastSyncAt,
      lastError: row.lastError,
      archivedAt: row.archivedAt,
      offices: offices.map(officeDto),
    };
  }

  /** Связи клуба принадлежат компании; счета — в KZT; проект — не больше чем у одного включённого клуба. */
  async function checkOffice(ex: Executor, companyId: number, input: SenetOfficeInput, exceptId: number | null): Promise<void> {
    const fields: Record<string, string> = {};
    for (const key of ['cashAccountId', 'kaspiAccountId'] as const) {
      const id = input[key];
      if (id === null) continue;
      const acc = await first(ex.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.companyId, companyId))));
      if (!acc) fields[key] = 'Счёт не найден';
      else if (acc.currency !== 'KZT') fields[key] = 'Валюта счёта не совпадает с валютой Senet (KZT)';
    }
    if (input.incomeCategoryId !== null) {
      const cat = await first(ex.select().from(categories).where(and(eq(categories.id, input.incomeCategoryId), eq(categories.companyId, companyId))));
      if (!cat || cat.kind !== 'income') fields.incomeCategoryId = 'Выберите доходную категорию';
    }
    if (input.projectId !== null) {
      const project = await first(ex.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, companyId))));
      if (!project) fields.projectId = 'Проект не найден';
      else if (input.enabled) {
        const taken = await first(
          ex
            .select({ id: senetOffices.id })
            .from(senetOffices)
            .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
            .where(
              and(
                eq(senetConnections.companyId, companyId),
                eq(senetOffices.enabled, true),
                eq(senetOffices.projectId, input.projectId),
                exceptId === null ? undefined : ne(senetOffices.id, exceptId),
              ),
            ),
        );
        if (taken) fields.projectId = 'Проект уже связан с другим клубом Senet';
      }
    }
    if (Object.keys(fields).length) throw new AppError(422, 'VALIDATION', 'Проверьте заполнение полей', fields);
  }

  async function assertOfficeFree(ex: Executor, connectionId: number, input: SenetOfficeInput, exceptId: number | null): Promise<void> {
    const clash = await first(
      ex
        .select({ id: senetOffices.id })
        .from(senetOffices)
        .where(
          and(
            eq(senetOffices.connectionId, connectionId),
            eq(senetOffices.senetOfficeId, input.senetOfficeId),
            eq(senetOffices.cashDeskId, input.cashDeskId),
            exceptId === null ? undefined : ne(senetOffices.id, exceptId),
          ),
        ),
    );
    if (clash) throw new AppError(422, 'SENET_OFFICE_TAKEN', 'Этот клуб Senet уже подключён');
  }

  const officeValues = (input: SenetOfficeInput) => ({
    senetOfficeId: input.senetOfficeId,
    cashDeskId: input.cashDeskId,
    name: input.name,
    enabled: input.enabled,
    projectId: input.projectId,
    cashAccountId: input.cashAccountId,
    kaspiAccountId: input.kaspiAccountId,
    incomeCategoryId: input.incomeCategoryId,
    historyFrom: input.historyFrom,
    cashOffset: input.cashOffset,
  });

  return {
    async list(companyId) {
      await requireCompany(db, companyId);
      const rows = await db.select().from(senetConnections).where(eq(senetConnections.companyId, companyId)).orderBy(asc(senetConnections.id));
      return Promise.all(rows.map((r) => dto(db, r)));
    },

    async check(companyId, input) {
      await requireCompany(db, companyId);
      try {
        return await sourceOf(input.org, credentialsOf(input)).check({ officeId: input.officeId, cashDeskId: input.cashDeskId }, now());
      } catch (e) {
        return asAppError(e);
      }
    },

    async create(companyId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const secrets = requireSecrets(true);
      const credentials = credentialsOf(input);
      const at = now().toISOString();
      const row = await mutate(db, audit, async (tx, record) => {
        const [created] = await tx
          .insert(senetConnections)
          .values({
            companyId,
            name: input.name,
            org: input.org,
            authMethod: input.authMethod,
            credentialsSecret: secrets.seal(JSON.stringify(credentials)),
            credentialsHint: hintOf(input.authMethod, credentials),
            createdAt: at,
            createdBy: userId,
          })
          .returning();
        await seedDefaultRules(tx, companyId, userId, at);
        await record({ companyId, userId, entity: 'senet_connection', entityId: created!.id, action: 'connect', diff: { after: { name: input.name, org: input.org, authMethod: input.authMethod } } });
        return created!;
      });
      return dto(db, row);
    },

    async update(companyId, id, patch, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await mutate(db, audit, async (tx, record) => {
        const current = await requireConnection(tx, companyId, id);
        const set: Partial<typeof senetConnections.$inferInsert> = {};
        if (patch.name !== undefined && patch.name !== current.name) set.name = patch.name;
        if (patch.credentials) {
          const credentials = credentialsOf(patch.credentials);
          set.authMethod = patch.credentials.authMethod;
          set.credentialsSecret = requireSecrets(true).seal(JSON.stringify(credentials));
          set.credentialsHint = hintOf(patch.credentials.authMethod, credentials);
          set.status = 'ok';
          set.lastError = null;
        }
        if (patch.archived !== undefined && patch.archived !== (current.archivedAt !== null)) set.archivedAt = patch.archived ? now().toISOString() : null;
        if (Object.keys(set).length === 0) return current;
        const [updated] = await tx.update(senetConnections).set(set).where(eq(senetConnections.id, id)).returning();
        const action = patch.archived === undefined || 'name' in set || 'credentialsSecret' in set ? 'update' : patch.archived ? 'archive' : 'unarchive';
        const shown = { name: set.name, authMethod: set.authMethod, credentialsReplaced: set.credentialsSecret ? true : undefined };
        await record({ companyId, userId, entity: 'senet_connection', entityId: id, action, diff: { after: shown } });
        return updated!;
      });
      return dto(db, row);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      await mutate(db, audit, async (tx, record) => {
        const current = await requireConnection(tx, companyId, id);
        const officeIds = (await tx.select({ id: senetOffices.id }).from(senetOffices).where(eq(senetOffices.connectionId, id))).map((o) => o.id);
        const shiftIds = officeIds.length ? (await tx.select({ id: senetShifts.id }).from(senetShifts).where(inArray(senetShifts.officeId, officeIds))).map((s) => s.id) : [];
        if (shiftIds.length) {
          const posted =
            (await first(tx.select({ id: senetPostings.id }).from(senetPostings).where(inArray(senetPostings.shiftId, shiftIds)).limit(1))) ??
            (await first(
              tx
                .select({ id: senetCashMoves.id })
                .from(senetCashMoves)
                .where(and(inArray(senetCashMoves.shiftId, shiftIds), or(isNotNull(senetCashMoves.operationId), isNotNull(senetCashMoves.prevOperationId))))
                .limit(1),
            ));
          if (posted) throw new AppError(409, 'SENET_POSTED', 'Из этого подключения уже проведены операции — его можно только отключить');
          const moveIds = (await tx.select({ id: senetCashMoves.id }).from(senetCashMoves).where(inArray(senetCashMoves.shiftId, shiftIds))).map((m) => m.id);
          await tx.delete(senetReviewItems).where(inArray(senetReviewItems.shiftId, shiftIds));
          if (moveIds.length) await tx.delete(senetBarPurchases).where(inArray(senetBarPurchases.cashMoveId, moveIds));
          await tx.delete(senetCashMoves).where(inArray(senetCashMoves.shiftId, shiftIds));
          await tx.delete(senetSoldItems).where(inArray(senetSoldItems.shiftId, shiftIds));
        }
        if (officeIds.length) {
          // всё, что ссылается на клуб: данные забора, аналитики и покрытие
          for (const t of [senetSoldItems, senetTransactions, senetChecks, senetRefills, senetStock, senetGoodsMoves, senetLoad, senetTickets, senetDataSpans, senetZones] as const) await tx.delete(t).where(inArray(t.officeId, officeIds));
          await tx.delete(senetShifts).where(inArray(senetShifts.officeId, officeIds));
          await tx.delete(senetRaw).where(inArray(senetRaw.officeId, officeIds));
          await tx.delete(senetRules).where(inArray(senetRules.officeId, officeIds));
          await tx.delete(senetOffices).where(eq(senetOffices.connectionId, id));
        }
        await tx.delete(senetRaw).where(eq(senetRaw.connectionId, id));
        await tx.delete(senetSyncRuns).where(eq(senetSyncRuns.connectionId, id));
        await tx.delete(senetConnections).where(eq(senetConnections.id, id));
        await record({ companyId, userId, entity: 'senet_connection', entityId: id, action: 'delete', diff: { before: { name: current.name, org: current.org } } });
      });
    },

    async createOffice(companyId, connectionId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await mutate(db, audit, async (tx, record) => {
        await requireConnection(tx, companyId, connectionId);
        await assertOfficeFree(tx, connectionId, input, null);
        await checkOffice(tx, companyId, input, null);
        const [created] = await tx.insert(senetOffices).values({ connectionId, ...officeValues(input) }).returning();
        await record({ companyId, userId, entity: 'senet_office', entityId: created!.id, action: 'create', diff: { after: officeValues(input) } });
        return created!;
      });
      return officeDto(row);
    },

    async updateOffice(companyId, officeId, input, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await mutate(db, audit, async (tx, record) => {
        const current = await first(
          tx
            .select({ office: senetOffices })
            .from(senetOffices)
            .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
            .where(and(eq(senetOffices.id, officeId), eq(senetConnections.companyId, companyId))),
        );
        if (!current) throw new AppError(404, 'NOT_FOUND', 'Клуб Senet не найден');
        await assertOfficeFree(tx, current.office.connectionId, input, officeId);
        await checkOffice(tx, companyId, input, officeId);
        const [updated] = await tx.update(senetOffices).set(officeValues(input)).where(eq(senetOffices.id, officeId)).returning();
        await record({ companyId, userId, entity: 'senet_office', entityId: officeId, action: 'update', diff: { before: officeDto(current.office), after: officeValues(input) } });
        return updated!;
      });
      return officeDto(row);
    },

    async sourceFor(connectionId) {
      const row = await first(db.select().from(senetConnections).where(eq(senetConnections.id, connectionId)));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Подключение Senet не найдено');
      const secrets = d.secrets(false);
      if (!secrets) throw new SecretsError('missing', 'Нет секретного ключа — данные входа не расшифровать');
      const credentials = JSON.parse(secrets.open(row.credentialsSecret)) as AdminCredentials;
      return sourceOf(row.org, credentials, async (token) => {
        const next = { ...credentials, token };
        await withTx(db, async (tx) => {
          await tx.update(senetConnections).set({ credentialsSecret: secrets.seal(JSON.stringify(next)) }).where(eq(senetConnections.id, connectionId));
        });
      });
    },
  };
}
