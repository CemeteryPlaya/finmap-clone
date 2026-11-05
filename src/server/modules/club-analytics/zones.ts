import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import type { ZonesInput } from '../../../shared/schemas/club-analytics';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { senetConnections, senetLoad, senetOffices, senetZones } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

/** Зона клуба (спецификация «Аналитика клуба», §6.1): найдено мест по данным за 30 дней и своё число (null — по данным). */
export interface ZoneView {
  zone: string;
  found: number;
  seats: number | null;
}

const DAYS_30 = 30 * 86_400_000;
const byName = (a: { zone: string }, b: { zone: string }) => a.zone.localeCompare(b.zone, 'ru');

/** Разных мест зон клубов в `senet_load` за 30 дней до `until`: клуб → зона → мест. */
async function foundSeats(db: Db, officeIds: readonly number[], until: string): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>(officeIds.map((id) => [id, new Map()]));
  if (!officeIds.length) return out;
  const since = new Date(Date.parse(until) - DAYS_30).toISOString();
  const rows = await db
    .selectDistinct({ officeId: senetLoad.officeId, zone: senetLoad.zone, workstation: senetLoad.workstation })
    .from(senetLoad)
    .where(and(inArray(senetLoad.officeId, [...officeIds]), gte(senetLoad.startAt, since), lt(senetLoad.startAt, until), isNotNull(senetLoad.workstation)));
  for (const r of rows) {
    const zones = out.get(r.officeId)!;
    zones.set(r.zone, (zones.get(r.zone) ?? 0) + 1);
  }
  return out;
}

async function savedSeats(db: Db, officeIds: readonly number[]): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>(officeIds.map((id) => [id, new Map()]));
  if (!officeIds.length) return out;
  for (const r of await db.select().from(senetZones).where(inArray(senetZones.officeId, [...officeIds]))) out.get(r.officeId)!.set(r.zone, r.seats);
  return out;
}

/** Зоны клуба: найденные по данным ∪ сохранённые, по имени. */
function zoneViews(found: Map<string, number>, saved: Map<string, number>): ZoneView[] {
  const names = new Set([...found.keys(), ...saved.keys()]);
  return [...names].map((zone) => ({ zone, found: found.get(zone) ?? 0, seats: saved.get(zone) ?? null })).sort(byName);
}

/** Места зон клубов для отчёта «Загрузка» (§6.1): своё число, иначе найденное за 30 дней до `until`. */
export async function zoneSeats(db: Db, officeIds: readonly number[], until: string): Promise<Map<number, Map<string, number>>> {
  const [found, saved] = await Promise.all([foundSeats(db, officeIds, until), savedSeats(db, officeIds)]);
  return new Map(officeIds.map((id) => [id, new Map(zoneViews(found.get(id)!, saved.get(id)!).map((z) => [z.zone, z.seats ?? z.found]))]));
}

/** Строка истории: «VIP 10, Общий 30». */
const seatsText = (zones: readonly ZoneView[]) =>
  zones
    .filter((z) => z.seats !== null)
    .map((z) => `${z.zone} ${z.seats}`)
    .join(', ');

export function createClubZones(d: { db: Db; audit: AuditService; now: () => Date }) {
  const { db } = d;

  /** Клуб Senet компании; чужой — 404. */
  async function office(companyId: number, officeId: number) {
    const row = await first(
      db
        .select({ id: senetOffices.id })
        .from(senetOffices)
        .innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId))
        .where(and(eq(senetOffices.id, officeId), eq(senetConnections.companyId, companyId))),
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Клуб Senet не найден');
  }

  async function list(officeId: number): Promise<ZoneView[]> {
    const [found, saved] = await Promise.all([foundSeats(db, [officeId], d.now().toISOString()), savedSeats(db, [officeId])]);
    return zoneViews(found.get(officeId)!, saved.get(officeId)!);
  }

  return {
    async list(companyId: number, officeId: number): Promise<ZoneView[]> {
      await requireCompany(db, companyId);
      await office(companyId, officeId);
      return list(officeId);
    },

    /** Своё число мест зон: `seats: null` — по данным (строка удаляется); строка в истории клуба. */
    async put(companyId: number, officeId: number, input: ZonesInput, userId: number): Promise<ZoneView[]> {
      await requireCompany(db, companyId, { writable: true });
      await office(companyId, officeId);
      const before = await list(officeId);
      await mutate(db, d.audit, async (tx, record) => {
        for (const z of input.zones) {
          await tx.delete(senetZones).where(and(eq(senetZones.officeId, officeId), eq(senetZones.zone, z.zone)));
          if (z.seats !== null) await tx.insert(senetZones).values({ officeId, zone: z.zone, seats: z.seats });
        }
        const after = seatsText(zoneViews(new Map(), new Map((await tx.select().from(senetZones).where(eq(senetZones.officeId, officeId))).map((r) => [r.zone, r.seats]))));
        await record({ companyId, userId, entity: 'senet_office', entityId: officeId, action: 'update', diff: { before: { zones: seatsText(before) }, after: { zones: after } } });
      });
      return list(officeId);
    },
  };
}

export type ClubZones = ReturnType<typeof createClubZones>;
