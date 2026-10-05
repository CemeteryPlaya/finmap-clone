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

  it('reset очищает счётчик ключа', () => {
    const l = new LoginLimiter(2, 1000, () => 0);
    l.recordFailure(['login:a']);
    l.recordFailure(['login:a']);
    expect(l.isBlocked(['login:a'])).toBe(true);
    l.reset(['login:a']);
    expect(l.isBlocked(['login:a'])).toBe(false);
  });
});
