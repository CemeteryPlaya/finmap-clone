import { describe, expect, it } from 'vitest';
import { ageBuckets, cohorts, countVisits, firstVisits, guestBuckets, lastAges, visitsOf, type GuestSession } from '../../src/shared/club-analytics/guests';

const TZ = 'Asia/Almaty';
/** Местное время Алматы (UTC+5) → ISO UTC. */
const t = (local: string) => new Date(`${local}:00+05:00`).toISOString();
const s = (guest: number, from: string, to: string, age: number | null = null, workstation = 1): GuestSession => ({
  guest,
  startAt: t(from),
  endAt: t(to),
  debited: 0,
  age,
  zone: 'VIP',
  workstation,
});

describe('visitsOf', () => {
  it('перерыв 29 минут — тот же визит, 31 и ровно 30 — новый', () => {
    const one = visitsOf([s(0, '2026-11-03T10:00', '2026-11-03T11:00'), s(0, '2026-11-03T11:29', '2026-11-03T12:00')]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ startAt: t('2026-11-03T10:00'), endAt: t('2026-11-03T12:00') });
    expect(one[0]!.sessions).toHaveLength(2);
    expect(visitsOf([s(0, '2026-11-03T10:00', '2026-11-03T11:00'), s(0, '2026-11-03T11:31', '2026-11-03T12:00')])).toHaveLength(2);
    expect(visitsOf([s(0, '2026-11-03T10:00', '2026-11-03T11:00'), s(0, '2026-11-03T11:30', '2026-11-03T12:00')])).toHaveLength(2);
  });

  it('наложенные сеансы на двух местах — один визит до последнего конца', () => {
    const v = visitsOf([s(0, '2026-11-03T10:30', '2026-11-03T11:30', null, 2), s(0, '2026-11-03T10:00', '2026-11-03T11:00')]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ startAt: t('2026-11-03T10:00'), endAt: t('2026-11-03T11:30') });
  });

  it('визиты разных гостей не сливаются; порядок — по гостю и началу', () => {
    const v = visitsOf([s(1, '2026-11-03T10:00', '2026-11-03T11:00'), s(0, '2026-11-03T10:10', '2026-11-03T11:00')]);
    expect(v.map((x) => x.guest)).toEqual([0, 1]);
  });
});

describe('guestBuckets', () => {
  const visits = visitsOf([
    s(0, '2026-10-20T18:00', '2026-10-20T20:00'),
    s(0, '2026-11-03T18:00', '2026-11-03T19:00'),
    s(1, '2026-11-04T18:00', '2026-11-04T18:30'),
    s(1, '2026-11-06T18:00', '2026-11-06T20:00'),
    s(2, '2026-11-01T23:50', '2026-11-02T01:00'),
  ]);
  const first = firstVisits(visits);

  it('неделя: гости, новые, вернувшиеся, визиты и время', () => {
    const [week] = guestBuckets(visits, first, [{ from: '2026-11-02', to: '2026-11-08' }], TZ);
    expect(week).toEqual({ guests: 2, newGuests: 1, returning: 1, visits: 3, visitSec: 3600 + 1800 + 7200 });
  });

  it('день: гость, впервые пришедший раньше этого дня, — вернувшийся', () => {
    const [, day6] = guestBuckets(visits, first, [{ from: '2026-11-04', to: '2026-11-04' }, { from: '2026-11-06', to: '2026-11-06' }], TZ);
    expect(day6).toEqual({ guests: 1, newGuests: 0, returning: 1, visits: 1, visitSec: 7200 });
  });

  it('визит, начатый до полуночи, относится к дню начала', () => {
    const [day2] = guestBuckets(visits, first, [{ from: '2026-11-02', to: '2026-11-02' }], TZ);
    expect(day2!.guests).toBe(0);
  });
});

describe('countVisits (чеки, R30)', () => {
  it('визиты и их время по корзинам дня начала; вне корзин не считаются', () => {
    const checks = visitsOf([
      s(0, '2026-11-03T10:00', '2026-11-03T11:00'),
      s(0, '2026-11-03T11:10', '2026-11-03T12:00'),
      s(1, '2026-11-03T23:30', '2026-11-04T01:00'),
      s(2, '2026-11-04T15:00', '2026-11-04T15:30'),
      s(3, '2026-11-09T15:00', '2026-11-09T16:00'),
    ]);
    expect(countVisits(checks, [{ from: '2026-11-03', to: '2026-11-03' }, { from: '2026-11-04', to: '2026-11-05' }], TZ)).toEqual([
      { visits: 2, visitSec: 7200 + 5400 },
      { visits: 1, visitSec: 1800 },
    ]);
  });
});

describe('возраст', () => {
  it('корзины возраста и доля «не указан»', () => {
    const b = ageBuckets([13, 14, 17, 18, 25, 35, null, null]);
    expect(b.map((x) => x.label)).toEqual(['до 14', '14–17', '18–24', '25–34', '35+', 'не указан']);
    expect(b.map((x) => x.count)).toEqual([1, 2, 1, 1, 1, 2]);
    expect(b[5]!.share).toBe(0.25);
    expect(ageBuckets([]).every((x) => x.share === 0)).toBe(true);
  });

  it('последний указанный возраст гостя', () => {
    const v = visitsOf([
      s(0, '2026-11-01T10:00', '2026-11-01T11:00', 19),
      s(0, '2026-11-02T10:00', '2026-11-02T11:00', null),
      s(0, '2026-11-03T10:00', '2026-11-03T11:00', 20),
      s(0, '2026-11-04T10:00', '2026-11-04T11:00', null),
      s(1, '2026-11-04T10:00', '2026-11-04T11:00', null),
    ]);
    expect(lastAges(v)).toEqual(new Map([[0, 20], [1, null]]));
  });
});

describe('cohorts', () => {
  it('когорты с неполным месяцем: будущие месяцы пусты, текущий — со значением', () => {
    const visits = visitsOf([
      s(0, '2026-09-05T10:00', '2026-09-05T11:00'),
      s(0, '2026-10-05T10:00', '2026-10-05T11:00'),
      s(1, '2026-09-10T10:00', '2026-09-10T11:00'),
      s(2, '2026-11-01T00:30', '2026-11-01T01:00'),
    ]);
    const rows = cohorts(visits, firstVisits(visits), ['2026-09', '2026-10'], '2026-11', TZ);
    expect(rows[0]).toEqual({ month: '2026-09', size: 2, shares: [1, 0.5, 0, null, null, null, null] });
    expect(rows[1]).toEqual({ month: '2026-10', size: 0, shares: [null, null, null, null, null, null, null] });
  });
});
