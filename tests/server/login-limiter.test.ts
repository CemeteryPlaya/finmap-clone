import { describe, expect, it } from 'vitest';
import { LoginLimiter } from '../../src/server/modules/auth/login-limiter';

describe('LoginLimiter', () => {
  it('блокирует после 5 неудач за 15 минут по любому из ключей', () => {
    let now = 0;
    const l = new LoginLimiter(5, 15 * 60_000, () => now);
    for (let i = 0; i < 5; i++) l.recordFailure(['login:admin', 'ip:1.1.1.1']);
    expect(l.isBlocked(['login:admin', 'ip:2.2.2.2'])).toBe(true);
    expect(l.isBlocked(['login:other', 'ip:1.1.1.1'])).toBe(true);
    expect(l.isBlocked(['login:other', 'ip:2.2.2.2'])).toBe(false);
    now = 15 * 60_000 + 1;
    expect(l.isBlocked(['login:admin', 'ip:1.1.1.1'])).toBe(false);
  });

  it('tryBegin резервирует попытки: одновременные сверх max получают отказ', () => {
    const l = new LoginLimiter(5, 15 * 60_000, () => 0);
    const keys = ['login:admin', 'ip:1.1.1.1'];
    const results = Array.from({ length: 8 }, () => l.tryBegin(keys));
    expect(results).toEqual([true, true, true, true, true, false, false, false]);
    // другой логин с того же IP тоже упирается в резерв по IP
    expect(l.tryBegin(['login:other', 'ip:1.1.1.1'])).toBe(false);
    // успешные завершения освобождают резерв, не записывая неудач
    l.end(keys, false);
    expect(l.tryBegin(keys)).toBe(true);
  });

  it('end(failed) записывает неудачу и освобождает резерв', () => {
    const l = new LoginLimiter(2, 1000, () => 0);
    const keys = ['login:a', 'ip:x'];
    expect(l.tryBegin(keys)).toBe(true);
    expect(l.tryBegin(keys)).toBe(true);
    expect(l.tryBegin(keys)).toBe(false);
    l.end(keys, true);
    l.end(keys, true);
    expect(l.isBlocked(keys)).toBe(true);
    expect(l.tryBegin(keys)).toBe(false);
  });

  it('периодически вычищает ключи без свежих неудач и без резерва', () => {
    let now = 0;
    const l = new LoginLimiter(5, 1000, () => now);
    for (let i = 0; i < 50; i++) l.recordFailure([`ip:${i}`]);
    expect(l.size()).toBe(50);
    now = 2000;
    for (let i = 0; i < 200; i++) {
      if (l.tryBegin(['login:z'])) l.end(['login:z'], false);
    }
    expect(l.size()).toBe(0);
  });

  it('reset очищает счётчик ключа', () => {
    const l = new LoginLimiter(2, 1000, () => 0);
    l.recordFailure(['login:a']);
    l.recordFailure(['login:a']);
    expect(l.isBlocked(['login:a'])).toBe(true);
    l.reset(['login:a']);
    expect(l.isBlocked(['login:a'])).toBe(false);
  });
});
