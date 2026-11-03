import { zoneOffsetMs } from '../dates';

const HOUR = 3_600_000;

/** Местный день, час и день недели момента (0 = понедельник, неделя с понедельника — §2.3 спецификации «Аналитика клуба»). */
export interface LocalHour {
  day: string;
  hour: number;
  weekday: number;
}

function localOf(t: number, timeZone: string): LocalHour {
  const local = new Date(t + zoneOffsetMs(t, timeZone));
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours(), weekday: (local.getUTCDay() + 6) % 7 };
}

/** День, час и день недели момента ISO в поясе timeZone. */
export function localParts(at: string, timeZone: string): LocalHour {
  return localOf(Date.parse(at), timeZone);
}

/** Отрезок `[startAt, endAt)` по часам местного времени: секунды в каждом часе, который он пересекает (§6.2). */
export function splitByHour(startAt: string, endAt: string, timeZone: string): (LocalHour & { seconds: number })[] {
  const end = Date.parse(endAt);
  const out: (LocalHour & { seconds: number })[] = [];
  for (let t = Date.parse(startAt); t < end; ) {
    const offset = zoneOffsetMs(t, timeZone);
    const next = Math.min(end, Math.floor((t + offset) / HOUR) * HOUR + HOUR - offset);
    out.push({ ...localOf(t, timeZone), seconds: Math.round((next - t) / 1000) });
    t = next;
  }
  return out;
}
