import { describe, expect, it } from 'vitest';
import { forceKillCommand, STOP_MESSAGES, stopApp, type StopDeps } from '../../scripts/lib/stop';

/** Мир с подменёнными часами: процессы «умирают» в заданный момент или от принудительного завершения. */
function world(o: {
  sup: number | null;
  srv: number | null;
  dieAtMs?: number | null;
  unkillable?: boolean;
  canForceKill?: (pid: number) => boolean;
}) {
  let clock = 0;
  const events: string[] = [];
  const killed = new Set<number>();
  const deps: StopDeps = {
    supervisorPid: o.sup,
    serverPid: o.srv,
    isAlive: (pid) => !killed.has(pid) && (o.dieAtMs == null || clock < o.dieAtMs),
    requestStop: () => events.push('request'),
    clearRequest: () => events.push('clear'),
    forceKill: (pid) => {
      events.push(`kill ${pid}`);
      if (!o.unkillable) killed.add(pid);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    timeoutMs: 20_000,
    killWaitMs: 5_000,
    ...(o.canForceKill ? { canForceKill: o.canForceKill } : {}),
  };
  return { deps, events, clock: () => clock };
}

describe('npm run stop', () => {
  it('ничего не запущено — ничего не делает', async () => {
    const w = world({ sup: null, srv: null });
    expect(await stopApp(w.deps)).toBe('not-running');
    expect(w.events).toEqual([]);
  });

  it('супервизор остановился по заявке — без принудительного завершения', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: 1500 });
    expect(await stopApp(w.deps)).toBe('stopped');
    expect(w.events).toEqual(['request']);
    expect(w.clock()).toBe(1500);
  });

  it('супервизор не ответил за 20 с — заявка убирается, процессы завершаются принудительно', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: null });
    expect(await stopApp(w.deps)).toBe('killed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100', 'kill 200']);
    expect(w.clock()).toBe(20_000);
  });

  it('сервер без супервизора (npm run dev) завершается сразу, без заявки и без «20 секунд» в сообщении', async () => {
    const w = world({ sup: null, srv: 200, dieAtMs: null });
    expect(await stopApp(w.deps)).toBe('killed-server');
    expect(w.events).toEqual(['kill 200']);
    expect(STOP_MESSAGES['killed-server']).not.toMatch(/20 секунд/);
  });

  it('процесс жив и после принудительного завершения — failed через 5 с ожидания', async () => {
    const w = world({ sup: 100, srv: null, dieAtMs: null, unkillable: true });
    expect(await stopApp(w.deps)).toBe('failed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100']);
    expect(w.clock()).toBe(25_000);
    expect(STOP_MESSAGES.failed).toMatch(/Перезагрузите/);
  });

  it('PID, который нельзя завершать (не подтверждён как наш), не передаётся в forceKill — итог failed', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: null, canForceKill: (pid) => pid !== 200 });
    expect(await stopApp(w.deps)).toBe('failed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100']);
    expect(w.events).not.toContain('kill 200');
    expect(w.clock()).toBe(25_000);
  });

  it('сервер без супервизора, которого нельзя завершать — forceKill не вызывается, failed', async () => {
    const w = world({ sup: null, srv: 200, dieAtMs: null, canForceKill: () => false });
    expect(await stopApp(w.deps)).toBe('failed');
    expect(w.events).toEqual([]);
  });

  it('canForceKill, разрешающий всё, ведёт себя как значение по умолчанию', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: null, canForceKill: () => true });
    expect(await stopApp(w.deps)).toBe('killed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100', 'kill 200']);
  });

  it('на Windows — taskkill всего дерева, на POSIX — сигнал (SIGKILL в обёртке)', () => {
    expect(forceKillCommand('win32', 4242)).toEqual({ cmd: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
    expect(forceKillCommand('linux', 4242)).toBeNull();
  });
});
