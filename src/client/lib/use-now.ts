import { useEffect, useState } from 'react';
import { timeOfDay, todayInTimezone } from '../../shared/dates';

/** Мс до начала следующей минуты. */
export function msToNextMinute(nowMs: number): number {
  return 60_000 - (nowMs % 60_000);
}

/** «Сегодня» и «ЧЧ:ММ» одного и того же момента в поясе приложения: у границы суток они не расходятся. */
export function nowParts(nowMs: number, timeZone: string): { today: string; time: string } {
  return { today: todayInTimezone(timeZone, new Date(nowMs)), time: timeOfDay(new Date(nowMs).toISOString(), timeZone) };
}

/** «Сейчас» (день и «ЧЧ:ММ») в поясе приложения; обновляется в начале каждой минуты (§2.3 этапа 1.5: «живое» время новой операции). */
export function useNow(timeZone: string): { today: string; time: string } {
  const [now, setNow] = useState(() => nowParts(Date.now(), timeZone));
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const next = nowParts(Date.now(), timeZone);
      // тот же день и минута — прежний объект, перерисовки не будет
      setNow((prev) => (prev.today === next.today && prev.time === next.time ? prev : next));
      timer = window.setTimeout(tick, msToNextMinute(Date.now()));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [timeZone]);
  return now;
}

/** Только «ЧЧ:ММ» из `useNow`. */
export function useNowTime(timeZone: string): string {
  return useNow(timeZone).time;
}
