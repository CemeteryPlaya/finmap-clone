import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { projects, senetConnections, senetOffices } from '../../db/schema';
import { AppError } from '../../errors';

/** Шаблон проектов-клубов (спецификация «Аналитика клуба», §1, решение 8). */
export const CLUB_TEMPLATE = 'computer-club';

export interface ClubScope {
  projects: { id: number; name: string; archived: boolean; pcCount: number | null }[];
  /** Клубы Senet с проектом из `projects` (выключенные тоже — §3.1). */
  offices: { id: number; projectId: number; connectionId: number; lastSyncAt: string | null }[];
  /** У компании есть неархивное подключение Senet. */
  connected: boolean;
  /** Самый ранний последний забор подключений клубов (§2.2). */
  freshness: string | null;
}

/** «Количество ПК» проекта; не задано или не число — null. */
function pcCountOf(params: string): number | null {
  const v = (JSON.parse(params) as { pcCount?: unknown }).pcCount;
  return typeof v === 'number' && v > 0 ? v : null;
}

/** Клубы компании для отчётов клуба (§3.1); `projectId` — один клуб, не клуб компании — 404. */
export async function clubScope(db: Db, companyId: number, projectId?: number): Promise<ClubScope> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt, params: projects.templateParams })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), eq(projects.templateKey, CLUB_TEMPLATE)))
    .orderBy(asc(projects.orderIndex), asc(projects.id));
  const all = rows.map((r) => ({ id: r.id, name: r.name, archived: r.archivedAt !== null, pcCount: pcCountOf(r.params) }));
  if (projectId !== undefined && !all.some((p) => p.id === projectId)) throw new AppError(404, 'NOT_FOUND', 'Клуб не найден');
  const chosen = projectId === undefined ? all : all.filter((p) => p.id === projectId);
  const connections = await db
    .select({ id: senetConnections.id, lastSyncAt: senetConnections.lastSyncAt })
    .from(senetConnections)
    .where(and(eq(senetConnections.companyId, companyId), isNull(senetConnections.archivedAt)));
  const synced = new Map(connections.map((c) => [c.id, c.lastSyncAt]));
  const officeRows = chosen.length
    ? await db
        .select({ id: senetOffices.id, projectId: senetOffices.projectId, connectionId: senetOffices.connectionId })
        .from(senetOffices)
        .where(and(inArray(senetOffices.projectId, chosen.map((p) => p.id)), inArray(senetOffices.connectionId, [...synced.keys(), -1])))
        .orderBy(asc(senetOffices.id))
    : [];
  const offices = officeRows.map((o) => ({ id: o.id, projectId: o.projectId!, connectionId: o.connectionId, lastSyncAt: synced.get(o.connectionId) ?? null }));
  return { projects: chosen, offices, connected: connections.length > 0, freshness: earliestSync(offices) };
}

/** Самый ранний последний забор подключений клубов; подключение без забора или нет клубов — null. */
function earliestSync(offices: readonly { lastSyncAt: string | null }[]): string | null {
  const times = offices.map((o) => o.lastSyncAt);
  if (times.length === 0 || times.includes(null)) return null;
  return (times as string[]).reduce((a, b) => (a < b ? a : b));
}

/** Без количества ПК у клубов «Выручка на ПК в день» не считается, загрузка — по местам зон (§4, §6.1, §13). */
export const NO_PC_NOTE = 'Задайте количество ПК в карточке проекта';

/**
 * Количество ПК клубов с подключённым клубом Senet (§6.1): клубы без данных в знаменатель не идут. Если у такого клуба
 * ПК не заданы — 0 (плитка недоступна): его часы вошли бы в числитель без его ПК в знаменателе.
 */
export function pcsOf(scope: ClubScope): number {
  const connected = new Set(scope.offices.map((o) => o.projectId));
  const clubs = scope.projects.filter((p) => connected.has(p.id));
  return clubs.some((p) => p.pcCount === null) ? 0 : clubs.reduce((t, p) => t + p.pcCount!, 0);
}
