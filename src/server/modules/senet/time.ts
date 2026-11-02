import { zoneOffsetMs } from '../../../shared/dates';

const EXCEL_EPOCH_DAYS = 25_569; // 01.01.1970 в днях Excel (от 30.12.1899)
const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;
const RU_LOCAL = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Время из xlsx Senet — без пояса, в часах клуба (§3.3) — в момент UTC: дата Excel (число дней) или строка
 * «YYYY-MM-DD HH:MM:SS[.ms]» / «DD.MM.YYYY HH:MM[:SS]». Перевод — по поясу timezone, не по часам сервера.
 * null — не время.
 */
export function localToUtc(local: string | number, timezone: string): string | null {
  let wall: number;
  if (typeof local === 'number') {
    if (!Number.isFinite(local)) return null;
    wall = Math.round((local - EXCEL_EPOCH_DAYS) * 86_400_000);
  } else {
    const s = local.trim();
    const iso = ISO_LOCAL.exec(s);
    const ru = iso ? null : RU_LOCAL.exec(s);
    if (iso) wall = Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!, +iso[4]!, +iso[5]!, +(iso[6] ?? 0), Number((iso[7] ?? '0').slice(0, 3).padEnd(3, '0')));
    else if (ru) wall = Date.UTC(+ru[3]!, +ru[2]! - 1, +ru[1]!, +ru[4]!, +ru[5]!, +(ru[6] ?? 0));
    else return null;
  }
  // второй шаг уточняет смещение на самом моменте (как startOfDayUtc)
  const first = wall - zoneOffsetMs(wall, timezone);
  return new Date(wall - zoneOffsetMs(first, timezone)).toISOString();
}
