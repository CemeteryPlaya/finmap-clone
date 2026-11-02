import { z } from 'zod';
import { nameField } from '../text';

/** Адрес организации Senet (С15§3.2): имя из адреса админ-панели; на чужой хост его не направить. */
export const SENET_ORG_RE = /^[a-z0-9-]{1,63}$/;
export const SENET_CONNECTION_NAME_MAX = 100;

export type SenetAuthMethod = 'password' | 'token';
export type SenetConnectionStatus = 'ok' | 'key_rejected' | 'unreachable';

const ORG_MESSAGE = 'Латиница, цифры и дефис — как в адресе админ-панели';
const text = z.string().trim().optional().default('');

/** Данные входа: логин и пароль отдельного пользователя Senet или токен (§3.2). */
const credentialsShape = {
  authMethod: z.enum(['password', 'token'], { message: 'Выберите способ входа' }),
  username: text,
  password: z.string().optional().default(''),
  token: text,
};

type Credentials = { authMethod: SenetAuthMethod; username: string; password: string; token: string };
function checkCredentials(v: Credentials, ctx: z.RefinementCtx, prefix: string[] = []): void {
  const need = (field: keyof Credentials, message: string) => {
    if (!v[field]) ctx.addIssue({ code: 'custom', path: [...prefix, field], message });
  };
  if (v.authMethod === 'password') {
    need('username', 'Введите логин пользователя Senet');
    need('password', 'Введите пароль');
  } else need('token', 'Вставьте токен');
}

function checkOrg(org: string, ctx: z.RefinementCtx): void {
  if (!SENET_ORG_RE.test(org)) ctx.addIssue({ code: 'custom', path: ['org'], message: ORG_MESSAGE });
}

const orgField = z.string().trim().toLowerCase();

export const senetCheckSchema = z
  .object({ org: orgField, ...credentialsShape, officeId: z.number().int().min(1).default(1), cashDeskId: z.number().int().min(1).default(1) })
  .superRefine((v, ctx) => {
    checkOrg(v.org, ctx);
    checkCredentials(v, ctx);
  });

export const senetConnectionCreateSchema = z
  .object({ name: nameField(SENET_CONNECTION_NAME_MAX), org: orgField, ...credentialsShape })
  .superRefine((v, ctx) => {
    checkOrg(v.org, ctx);
    checkCredentials(v, ctx);
  });

export const senetConnectionPatchSchema = z
  .object({
    name: nameField(SENET_CONNECTION_NAME_MAX).optional(),
    credentials: z.object(credentialsShape).optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.credentials) checkCredentials(v.credentials, ctx, ['credentials']);
  });

const idOrNull = z.number().int().positive().nullable().optional().default(null);

/** Клуб подключения и его связи (§8.1): у включённого клуба связи и «Загружать с даты» обязательны. */
export const senetOfficeSchema = z
  .object({
    senetOfficeId: z.number({ message: 'Введите номер клуба' }).int().min(1, 'Номер клуба — от 1'),
    cashDeskId: z.number().int().min(1, 'Номер кассы — от 1').default(1),
    name: z.string().trim().max(SENET_CONNECTION_NAME_MAX).optional().default(''),
    enabled: z.boolean().default(false),
    projectId: idOrNull,
    cashAccountId: idOrNull,
    kaspiAccountId: idOrNull,
    incomeCategoryId: idOrNull,
    historyFrom: z.iso.datetime({ message: 'Укажите дату и время' }).nullable().optional().default(null),
    /** Постоянная разница кассы «учёт − Senet», тиыны. */
    cashOffset: z.number().int().default(0),
  })
  .superRefine((v, ctx) => {
    if (!v.enabled) return;
    const need = (field: 'projectId' | 'cashAccountId' | 'kaspiAccountId' | 'incomeCategoryId' | 'historyFrom', message: string) => {
      if (v[field] === null) ctx.addIssue({ code: 'custom', path: [field], message });
    };
    need('projectId', 'Выберите проект');
    need('cashAccountId', 'Выберите счёт кассы');
    need('kaspiAccountId', 'Выберите счёт Kaspi');
    need('incomeCategoryId', 'Выберите категорию дохода смены');
    need('historyFrom', 'Укажите, с какой даты загружать смены');
  });

export type SenetCheckInput = z.infer<typeof senetCheckSchema>;
export type SenetConnectionCreateInput = z.infer<typeof senetConnectionCreateSchema>;
export type SenetConnectionPatchInput = z.infer<typeof senetConnectionPatchSchema>;
export type SenetOfficeInput = z.infer<typeof senetOfficeSchema>;

export interface SenetOfficeDto extends SenetOfficeInput {
  id: number;
}

export interface SenetConnectionDto {
  id: number;
  name: string;
  org: string;
  source: 'admin_token' | 'app_key';
  authMethod: SenetAuthMethod | 'app_key';
  credentialsHint: string;
  status: SenetConnectionStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  archivedAt: string | null;
  offices: SenetOfficeDto[];
}

export interface SenetCheckResult {
  officeName: string | null;
  shifts: number;
  lastClosedAt: string | null;
}

const DAY_MS = 86_400_000;

/** «Обновить сейчас» — без дат; «Загрузить за период» — с даты по дату, не больше 366 дней (С15§5.4). */
export const senetSyncSchema = z
  .object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() })
  .superRefine((v, ctx) => {
    if (!v.from && !v.to) return;
    if (!v.from || !v.to) return ctx.addIssue({ code: 'custom', path: [v.from ? 'to' : 'from'], message: 'Укажите обе даты' });
    if (v.from >= v.to) return ctx.addIssue({ code: 'custom', path: ['to'], message: 'Конец периода — позже начала' });
    if (Date.parse(v.to) - Date.parse(v.from) > 366 * DAY_MS) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Не больше 366 дней за раз' });
  });

export interface SenetSyncRunDto {
  id: number;
  connectionId: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: 'hourly' | 'cron' | 'manual' | 'period';
  result: 'ok' | 'partial' | 'failed' | null;
  error: string | null;
  counts: Record<string, number>;
}

export const SENET_RULE_TYPES = [
  'exact',
  'kaspi',
  'trainee',
  'salary_word',
  'extra_pay_word',
  'employee_alias',
  'master',
  'owner_word',
  'owner_a_alias',
  'lunch',
  'keyword',
  'bar_item',
  'bar_supplier',
] as const;
export type SenetRuleType = (typeof SENET_RULE_TYPES)[number];
export const SENET_MATCH_MODES = ['word', 'first', 'phrase', 'prefix', 'contains'] as const;
export type SenetMatchMode = (typeof SENET_MATCH_MODES)[number];
/** Типы с настроечной строкой (пустой шаблон): категория, владельцы, поставщик по умолчанию (§4.3). */
export const SENET_SETTING_TYPES: readonly SenetRuleType[] = ['salary_word', 'owner_word', 'owner_a_alias', 'lunch', 'bar_item', 'bar_supplier'];
/** Алиас — одно слово: разноска ищет его среди слов комментария. */
const SINGLE_WORD_TYPES: readonly SenetRuleType[] = ['employee_alias', 'master', 'owner_word', 'owner_a_alias'];

/** Правило разноски (§4.3, §8.1); шаблон нормализует сервер. */
export const senetRuleSchema = z
  .object({
    type: z.enum(SENET_RULE_TYPES),
    pattern: z.string().max(200).default(''),
    match: z.enum(SENET_MATCH_MODES).default('word'),
    officeId: z.number().int().positive().nullable().optional().default(null),
    categoryId: z.number().int().positive().nullable().optional().default(null),
    counterpartyId: z.number().int().positive().nullable().optional().default(null),
    commentTemplate: z.string().trim().max(200).nullable().optional().default(null),
    flags: z.object({ mistaken: z.boolean().optional(), defect: z.boolean().optional() }).optional().default({}),
  })
  .superRefine((v, ctx) => {
    const p = v.pattern.trim();
    if (!p && !SENET_SETTING_TYPES.includes(v.type)) ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Введите слово или фразу' });
    if (p && SINGLE_WORD_TYPES.includes(v.type) && /\s/.test(p)) ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Алиас — одно слово' });
  });

export type SenetRuleInput = z.infer<typeof senetRuleSchema>;

export interface SenetRuleDto extends SenetRuleInput {
  id: number;
  priority: number;
  createdFromReview: boolean;
  archived: boolean;
}

export const senetRuleOrderSchema = z.object({ type: z.enum(SENET_RULE_TYPES), ids: z.array(z.number().int().positive()).max(1000) });

export const senetCheckHistorySchema = z.object({ officeId: z.number().int().positive(), from: z.iso.datetime(), to: z.iso.datetime() });

export interface SenetHistoryCheck {
  total: number;
  recognized: number;
  unrecognized: { moveId: number; at: string; amount: number; comment: string; reason: string }[];
  differs: { moveId: number; operationId: number; comment: string; was: { categoryId: number | null; counterpartyId: number | null }; would: { categoryId: number; counterpartyId: number | null } }[];
}
export type SenetCheckHistoryInput = z.infer<typeof senetCheckHistorySchema>;
