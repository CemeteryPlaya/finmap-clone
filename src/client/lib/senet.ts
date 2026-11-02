import { useQuery } from '@tanstack/react-query';
import { SENET_ORG_RE, type SenetAuthMethod, type SenetConnectionDto } from '../../shared/schemas/senet';
import { zoneOffsetMs } from '../../shared/dates';
import { api, type ApiError } from './api';
import { queryClient } from './query';

/**
 * «Интеграции» → Senet (спецификация 2026-11-02-senet-autopost, §8.1): подключения, клубы, состояние забора.
 */
export function useSenetConnections(companyId: number) {
  return useQuery<SenetConnectionDto[], ApiError>({
    queryKey: ['senet', companyId, 'connections'],
    queryFn: async () => (await api<{ connections: SenetConnectionDto[] }>(`/companies/${companyId}/senet/connections`)).connections,
  });
}

export const invalidateSenet = (companyId: number) => queryClient.invalidateQueries({ queryKey: ['senet', companyId] });

/**
 * Адрес организации из ввода: имя («club-demo») или ссылка на админ-панель («https://club-demo.admin-v2.enes.tech/»).
 * null — не похоже на адрес организации Senet.
 */
export function orgFromInput(text: string): string | null {
  let s = text.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').split('/')[0]!;
  const host = /^([a-z0-9-]+)\.(admin(?:-v2)?|app|api)\.enes\.tech$/.exec(s);
  const org = host ? host[1]! : s;
  return SENET_ORG_RE.test(org) ? org : null;
}

/** Итоговый адрес под полем «Адрес организации». */
export const senetAddress = (org: string) => `https://${org}.app.enes.tech`;

export interface ConnectionForm {
  org: string;
  authMethod: SenetAuthMethod;
  username: string;
  password: string;
  token: string;
  officeId: number;
  cashDeskId: number;
}

/** Отпечаток проверенных данных: «Сохранить» доступно, пока форма совпадает с последней успешной проверкой. */
export function connectionKey(f: ConnectionForm): string {
  const creds = f.authMethod === 'password' ? [f.username, f.password] : [f.token];
  return JSON.stringify([f.org, f.authMethod, ...creds, f.officeId, f.cashDeskId]);
}

/** Счета клуба по умолчанию (С15§3.3): «Касса {проект}» и «Kaspi {проект}» в KZT, не в архиве. */
export function defaultOfficeAccounts(
  accounts: readonly { id: number; name: string; currency: string; archivedAt: string | null }[],
  projectName: string,
): { cashAccountId: number | null; kaspiAccountId: number | null } {
  const find = (name: string) => accounts.find((a) => a.name === name && a.currency === 'KZT' && a.archivedAt === null)?.id ?? null;
  return { cashAccountId: find(`Касса ${projectName}`), kaspiAccountId: find(`Kaspi ${projectName}`) };
}

/** Значение поля datetime-local («YYYY-MM-DDTHH:MM») в часах клуба → момент UTC; пусто — null. */
export function localInputToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone)).toISOString();
}

/** Момент UTC → значение поля datetime-local в часах клуба. */
export function isoToLocalInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return new Date(t + zoneOffsetMs(t, timeZone)).toISOString().slice(0, 16);
}

/** Состояние подключения строкой карточки. */
export function statusText(c: Pick<SenetConnectionDto, 'status' | 'lastSyncAt' | 'archivedAt'>, formatTime: (iso: string) => string = (iso) => iso): string {
  if (c.archivedAt) return 'Отключено';
  if (c.status === 'key_rejected') return 'Обновите доступ к Senet — забор остановлен';
  if (c.status === 'unreachable') return 'Senet не отвечает — попробуем снова через час';
  return c.lastSyncAt ? `Подключено, последний забор ${formatTime(c.lastSyncAt)}` : 'Подключено, данных ещё не забирали';
}

/** Подключения с отказом доступа: баннер над «Журналом» и «Сверкой Senet» (§8.2). */
export function useSenetStatus(companyId: number) {
  return useQuery<{ rejected: { connectionId: number; name: string }[] }, ApiError>({
    queryKey: ['senet', companyId, 'status'],
    queryFn: () => api(`/companies/${companyId}/senet/status`),
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}

export function accessBanner(companyId: number, status: { rejected: readonly unknown[] }): { text: string; href: string } | null {
  return status.rejected.length ? { text: 'Обновите доступ к Senet — забор остановлен', href: `/c/${companyId}/settings/integrations` } : null;
}

/** Итог «Обновить сейчас» и «Загрузить за период» одной строкой. */
export function syncSummary(run: { result: 'ok' | 'partial' | 'failed' | null; error: string | null; counts: Record<string, number> }): string {
  if (run.result === 'failed') return run.error ?? 'Забор не удался';
  const c = run.counts;
  const text = `Загружено ${c.done ?? 0} из ${c.chunks ?? 0} отрезков: смен ${c.shifts ?? 0}, выемок и внесений ${c.moves ?? 0}`;
  return run.error ? `${text}. ${run.error}` : text;
}
