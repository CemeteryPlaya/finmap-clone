import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { groupGuests, sharedLogins, SHARED_WINDOW_DAYS, type GuestKey, type GuestLink, type Guests, type KeyPair } from '../../../shared/club-analytics/guest-links';
import type { GuestLinkInput } from '../../../shared/schemas/club-analytics';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { senetChecks, senetConnections, senetGuestLinks, senetLoad, senetOffices, senetRefills, senetTickets } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

/** Ссылка на ключ наружу (спецификация «Аналитика клуба», R25): хеш телефона из неё без секрета сервера не получить. */
export function keyRef(key: GuestKey): string {
  return crypto.createHash('sha256').update(`guest:${key}`).digest('hex').slice(0, 16);
}

export type StoredLink = GuestLink & { id: number; createdAt: string };

/** Правки гостей компании по порядку создания. */
export async function guestLinks(db: Db, companyId: number): Promise<StoredLink[]> {
  const rows = await db.select().from(senetGuestLinks).where(eq(senetGuestLinks.companyId, companyId)).orderBy(senetGuestLinks.id);
  return rows.map((r) => ({ id: r.id, kind: r.kind, a: r.keyA, b: r.keyB, createdAt: r.createdAt }));
}

/** Клубы Senet всех подключений компании (R17). */
async function companyOffices(db: Db, companyId: number): Promise<number[]> {
  const rows = await db.select({ id: senetOffices.id }).from(senetOffices).innerJoin(senetConnections, eq(senetConnections.id, senetOffices.connectionId)).where(eq(senetConnections.companyId, companyId));
  return rows.map((r) => r.id);
}

/** Различные пары «логин — хеш» таблицы с маской и последним временем. */
async function tablePairs(db: Db, ids: readonly number[], t: typeof senetRefills | typeof senetChecks | typeof senetTickets | typeof senetLoad): Promise<KeyPair[]> {
  const at = 'startAt' in t ? t.startAt : t.at;
  return db
    .select({ login: t.guestLogin, phoneHash: t.phoneHash, phoneMask: sql<string | null>`max(${t.phoneMask})`, lastAt: sql<string>`max(${at})` })
    .from(t)
    .where(inArray(t.officeId, [...ids]))
    .groupBy(t.guestLogin, t.phoneHash);
}

/** Одна пара из пар разных таблиц: последнее время, первая известная маска; строки без логина и телефона отброшены. */
export function mergePairs(all: readonly KeyPair[]): KeyPair[] {
  const out = new Map<string, KeyPair>();
  for (const p of all.filter((x) => x.login.trim() !== '' || x.phoneHash)) {
    const id = `${p.login}\u0000${p.phoneHash ?? ''}`;
    const cur = out.get(id) ?? p;
    out.set(id, { ...cur, phoneMask: cur.phoneMask ?? p.phoneMask, lastAt: String(p.lastAt > cur.lastAt ? p.lastAt : cur.lastAt) });
  }
  return [...out.values()];
}

/** Пары компании (§7.1): сеансы, пополнения, чеки, абонементы всех её клубов. */
export async function companyPairs(db: Db, companyId: number): Promise<KeyPair[]> {
  const ids = await companyOffices(db, companyId);
  if (!ids.length) return [];
  return mergePairs((await Promise.all([senetLoad, senetRefills, senetChecks, senetTickets].map((t) => tablePairs(db, ids, t)))).flat());
}

/** Гости компании на `now` (§7.1, R19): общие логины — по парам за 90 дней до `now`. */
export async function companyGuests(db: Db, companyId: number, now: string) {
  const [pairs, links] = await Promise.all([companyPairs(db, companyId), guestLinks(db, companyId)]);
  const shared = sharedLogins(pairs, new Date(Date.parse(now) - SHARED_WINDOW_DAYS * 86_400_000).toISOString());
  const guests: Guests = groupGuests(pairs, shared, links);
  return { guests, shared, pairs, links };
}

export type CompanyGuests = Awaited<ReturnType<typeof companyGuests>>;

/** Подпись ключа для экрана и истории: логин или маска телефона — не хеш. */
export function keyLabel(key: GuestKey, pairs: readonly KeyPair[]): string {
  if (key.startsWith('login:')) return key.slice('login:'.length);
  const hash = key.slice('phone:'.length);
  return pairs.find((p) => p.phoneHash === hash && p.phoneMask)?.phoneMask ?? 'телефон';
}

/** Ключ компании по ссылке; нет — 404. */
export function keyOfRef(cg: CompanyGuests, ref: string): GuestKey {
  const key = [...cg.guests.of.keys()].find((k) => keyRef(k) === ref);
  if (!key) throw new AppError(404, 'NOT_FOUND', 'Гость не найден');
  return key;
}

/** Правка по ключам входа (R18): `merge` — ключи по возрастанию; `split` — ключ сам с собой. */
export function linkOf(kind: GuestLink['kind'], a: GuestKey, b: GuestKey): GuestLink {
  if (kind === 'split') return { kind, a, b: a };
  return { kind, a: a < b ? a : b, b: a < b ? b : a };
}

/** Новая правка допустима (§7.1): объединяются разные гости; вынимается ключ гостя `b`, у которого ключей больше одного. */
export function checkLink(g: Guests, kind: GuestLink['kind'], a: GuestKey, b: GuestKey): void {
  const ga = g.of.get(a)!;
  const gb = g.of.get(b)!;
  if (kind === 'merge' && ga === gb) throw new AppError(422, 'SAME_GUEST', 'Это уже один гость');
  if (kind === 'split' && (ga !== gb || g.keys[ga]!.length < 2)) throw new AppError(422, 'NOTHING_TO_SPLIT', 'Нечего разделять');
}

export function createGuestLinks(d: { db: Db; audit: AuditService; now: () => Date }) {
  const { db } = d;
  const labels = (l: GuestLink, pairs: readonly KeyPair[]) => ({ kind: l.kind, a: keyLabel(l.a, pairs), b: keyLabel(l.b, pairs) });
  const same = (companyId: number, l: GuestLink) => and(eq(senetGuestLinks.companyId, companyId), eq(senetGuestLinks.kind, l.kind), eq(senetGuestLinks.keyA, l.a), eq(senetGuestLinks.keyB, l.b));

  return {
    /** «Это один гость» или «Разделить» (§7.1); такая же правка уже есть — её номер, без новой строки истории. */
    async create(companyId: number, input: GuestLinkInput, userId: number): Promise<{ id: number }> {
      await requireCompany(db, companyId, { writable: true });
      const now = d.now().toISOString();
      const cg = await companyGuests(db, companyId, now);
      const [a, b] = [keyOfRef(cg, input.a), keyOfRef(cg, input.b)];
      const link = linkOf(input.kind, a, b);
      const existing = await first(db.select({ id: senetGuestLinks.id }).from(senetGuestLinks).where(same(companyId, link)));
      if (existing) return { id: existing.id };
      checkLink(cg.guests, input.kind, a, b);
      return mutate(db, d.audit, async (tx, record) => {
        const row = (await tx.insert(senetGuestLinks).values({ companyId, keyA: link.a, keyB: link.b, kind: link.kind, createdBy: userId, createdAt: now }).returning({ id: senetGuestLinks.id }))[0]!;
        await record({ companyId, userId, entity: 'senet_guest_link', entityId: row.id, action: 'create', diff: { after: labels(link, cg.pairs) } });
        return { id: row.id };
      });
    },

    /** Снять правку; чужая или несуществующая — 404. */
    async remove(companyId: number, linkId: number, userId: number): Promise<void> {
      await requireCompany(db, companyId, { writable: true });
      const row = await first(db.select().from(senetGuestLinks).where(and(eq(senetGuestLinks.id, linkId), eq(senetGuestLinks.companyId, companyId))));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Правка не найдена');
      const pairs = await companyPairs(db, companyId);
      await mutate(db, d.audit, async (tx, record) => {
        await tx.delete(senetGuestLinks).where(eq(senetGuestLinks.id, linkId));
        await record({ companyId, userId, entity: 'senet_guest_link', entityId: linkId, action: 'delete', diff: { before: labels({ kind: row.kind, a: row.keyA, b: row.keyB }, pairs) } });
      });
    },
  };
}

export type GuestLinksService = ReturnType<typeof createGuestLinks>;
