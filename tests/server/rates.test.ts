import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { AppError } from '../../src/server/errors';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createRatesService } from '../../src/server/modules/rates/service';
import { DEC_ONE } from '../../src/shared/decimal';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup(base = 'KZT') {
  t = createTestDb();
  seedCurrencies(t.db);
  t.sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  const company = t.db.insert(companies).values({ name: 'ТОО', baseCurrency: base, createdAt: 'x' }).returning().get();
  const svc = createRatesService({ db: t.db, audit: createAuditService(t.db), now: () => new Date('2026-10-20T00:00:00.000Z') });
  return { svc, cid: company.id };
}

const unavailable = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('RATE_UNAVAILABLE');
    return (e as AppError).message;
  }
  throw new Error('ожидалась ошибка RATE_UNAVAILABLE');
};

describe('rates: определение курса (§4.3)', () => {
  it('курс базовой валюты = 1 без поиска', () => {
    const { svc, cid } = setup();
    expect(svc.resolve(cid, 'KZT', 'KZT', '2026-10-06')).toEqual({ rate: DEC_ONE, display: '1' });
  });

  it('ручной курс на D действует на D…D+7, не действует на D-1 и D+8', () => {
    const { svc, cid } = setup();
    svc.addManual({ date: '2026-10-01', currency: 'USD', rate: '475,12' }, 1);
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-01').display).toBe('475.12');
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-08').display).toBe('475.12');
    expect(unavailable(() => svc.resolve(cid, 'KZT', 'USD', '2026-10-09'))).toBe('Нет курса USD на 09.10.2026');
    expect(unavailable(() => svc.resolve(cid, 'KZT', 'USD', '2026-09-30'))).toBe('Нет курса USD на 30.09.2026');
    expect(svc.kztRate('USD', '2026-10-05')).toMatchObject({ date: '2026-10-01', source: 'manual' });
  });

  it('берётся ближайший предыдущий курс, а не первый попавшийся', () => {
    const { svc, cid } = setup();
    svc.addManual({ date: '2026-10-01', currency: 'USD', rate: '470' }, 1);
    svc.addManual({ date: '2026-10-03', currency: 'USD', rate: '480' }, 1);
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-05').display).toBe('480');
  });

  it('кросс-курс через тенге при базовой USD: KZT→USD и EUR→USD', () => {
    const { svc, cid } = setup('USD');
    svc.addManual({ date: '2026-10-06', currency: 'USD', rate: '475' }, 1);
    svc.addManual({ date: '2026-10-06', currency: 'EUR', rate: '520' }, 1);
    expect(svc.resolve(cid, 'USD', 'KZT', '2026-10-06').display).toBe('0.002105263158');
    expect(svc.resolve(cid, 'USD', 'EUR', '2026-10-06').display).toBe('1.094736842');
    // курс EUR на 20.10 есть, а базовой USD к тенге — нет (последний 06.10, старше 7 дней): сообщение называет USD
    svc.addManual({ date: '2026-10-20', currency: 'EUR', rate: '525' }, 1);
    expect(unavailable(() => svc.resolve(cid, 'USD', 'EUR', '2026-10-20'))).toBe('Нет курса USD на 20.10.2026');
  });

  it('фиксированный курс действует на validFrom и validTo включительно, на validTo+1 — уже нет', () => {
    const { svc, cid } = setup();
    svc.addFixed(cid, { currency: 'USD', rate: '500', validFrom: '2026-10-01', validTo: '2026-10-31' }, 1);
    svc.addManual({ date: '2026-11-01', currency: 'USD', rate: '470' }, 1);
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-01').display).toBe('500');
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-10-31').display).toBe('500');
    expect(svc.resolve(cid, 'KZT', 'USD', '2026-11-01').display).toBe('470');
    expect(unavailable(() => svc.resolve(cid, 'KZT', 'USD', '2026-09-30'))).toBe('Нет курса USD на 30.09.2026');
  });
});
