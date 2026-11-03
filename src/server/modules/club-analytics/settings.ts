import { and, eq, isNull } from 'drizzle-orm';
import {
  FINANCE_CARD_KEYS,
  FINANCE_GROUP,
  resolveDashboards,
  resolveTiles,
  type DashboardDef,
  type SavedDashboards,
  type SavedTiles,
  type TileDef,
} from '../../../shared/analytics-catalog';
import { savedDashboardsSchema, savedTilesSchema } from '../../../shared/schemas/club-analytics';
import { TEMPLATES } from '../../../templates';
import type { BusinessTemplate } from '../../../templates/types';
import type { Db } from '../../db/client';
import { analyticsSettings, projects } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

/** «Настройки → Аналитика» компании (спецификация «Аналитика клуба», §10): сохранённое, сведённое с каталогом. */
export interface AnalyticsSettingsView {
  dashboards: SavedDashboards;
  groups: { key: string; title: string }[];
  /** Плитки «Обзора» по ключу шаблона. */
  tiles: Record<string, SavedTiles>;
  catalog: Record<string, { dashboards: readonly DashboardDef[]; tiles: readonly TileDef[] }>;
}

export type AnalyticsSettingKey = 'dashboards' | `tiles.${string}`;

type WithAnalytics = BusinessTemplate & { analytics: NonNullable<BusinessTemplate['analytics']> };

/** Настройки компании, сведённые с каталогом шаблонов в ходу. */
function build(templates: readonly WithAnalytics[], stored: Map<string, unknown>): AnalyticsSettingsView {
  const available = [{ key: FINANCE_GROUP.key, cards: [...FINANCE_CARD_KEYS] }, ...templates.map((t) => ({ key: t.key, cards: t.analytics.dashboards.map((c) => c.key) }))];
  return {
    dashboards: resolveDashboards((stored.get('dashboards') as SavedDashboards | undefined) ?? null, available),
    groups: [{ ...FINANCE_GROUP }, ...templates.map((t) => ({ key: t.key, title: t.name }))],
    tiles: Object.fromEntries(templates.map((t) => [t.key, resolveTiles((stored.get(`tiles.${t.key}`) as SavedTiles | undefined) ?? null, t.analytics.tiles)])),
    catalog: Object.fromEntries(templates.map((t) => [t.key, { dashboards: t.analytics.dashboards, tiles: t.analytics.tiles }])),
  };
}

/** Действующее значение ключа (с умолчаниями) — для сравнения «до» и «после». */
const current = (v: AnalyticsSettingsView, key: AnalyticsSettingKey) => (key === 'dashboards' ? v.dashboards : v.tiles[key.slice('tiles.'.length)]);

/** Ключ настройки компании: `dashboards` или плитки шаблона, проекты которого есть в компании; иначе 404. */
function checkKey(key: string, templates: readonly WithAnalytics[]): AnalyticsSettingKey {
  if (key === 'dashboards') return key;
  if (key.startsWith('tiles.') && templates.some((t) => `tiles.${t.key}` === key)) return key as AnalyticsSettingKey;
  throw new AppError(404, 'NOT_FOUND', 'Настройка не найдена');
}

export function createAnalyticsSettings(d: { db: Db; audit: AuditService; now: () => Date }) {
  const { db } = d;

  /** Шаблоны с дашбордами, у которых в компании есть неархивный проект (§10.1). */
  async function templatesInUse(companyId: number): Promise<WithAnalytics[]> {
    const rows = await db.selectDistinct({ key: projects.templateKey }).from(projects).where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)));
    const used = new Set(rows.map((r) => r.key));
    return TEMPLATES.filter((t): t is WithAnalytics => !!t.analytics && used.has(t.key));
  }

  async function saved(companyId: number): Promise<Map<string, unknown>> {
    const rows = await db.select().from(analyticsSettings).where(eq(analyticsSettings.companyId, companyId));
    return new Map(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  }

  return {
    async get(companyId: number): Promise<AnalyticsSettingsView> {
      await requireCompany(db, companyId);
      return build(await templatesInUse(companyId), await saved(companyId));
    },

    async put(companyId: number, rawKey: string, value: unknown, userId: number): Promise<AnalyticsSettingsView> {
      await requireCompany(db, companyId, { writable: true });
      const templates = await templatesInUse(companyId);
      const key = checkKey(rawKey, templates);
      const parsed = key === 'dashboards' ? savedDashboardsSchema.parse(value) : savedTilesSchema.parse(value);
      const stored = await saved(companyId);
      const before = current(build(templates, stored), key);
      const next = new Map(stored).set(key, parsed);
      const after = current(build(templates, next), key);
      // та же действующая настройка — без записи и без строки истории (как «Финансовые показатели», §17.9 спецификации «Аналитика»)
      if (JSON.stringify(before) === JSON.stringify(after)) return build(templates, stored);
      await mutate(db, d.audit, async (tx, record) => {
        const row = { value: JSON.stringify(after), updatedAt: d.now().toISOString(), updatedBy: userId };
        await tx
          .insert(analyticsSettings)
          .values({ companyId, key, ...row })
          .onConflictDoUpdate({ target: [analyticsSettings.companyId, analyticsSettings.key], set: row });
        await record({ companyId, userId, entity: 'analytics_settings', action: 'update', diff: { key, before, after } });
      });
      return build(templates, next);
    },

    /** «Вернуть как было» (§10.1): умолчания каталога. */
    async reset(companyId: number, rawKey: string, userId: number): Promise<AnalyticsSettingsView> {
      await requireCompany(db, companyId, { writable: true });
      const templates = await templatesInUse(companyId);
      const key = checkKey(rawKey, templates);
      const stored = await saved(companyId);
      if (!stored.has(key)) return build(templates, stored);
      const before = current(build(templates, stored), key);
      await mutate(db, d.audit, async (tx, record) => {
        await tx.delete(analyticsSettings).where(and(eq(analyticsSettings.companyId, companyId), eq(analyticsSettings.key, key)));
        await record({ companyId, userId, entity: 'analytics_settings', action: 'delete', diff: { key, before } });
      });
      stored.delete(key);
      return build(templates, stored);
    },
  };
}

export type AnalyticsSettings = ReturnType<typeof createAnalyticsSettings>;
