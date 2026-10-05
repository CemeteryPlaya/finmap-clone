import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createSupervisor, type ChildLike } from '../../scripts/lib/supervise';

class FakeChild extends EventEmitter implements ChildLike {
  pid? = 1;
  connected = true;
  killed: string[] = [];
  sent: unknown[] = [];
  kill(sig: NodeJS.Signals | number = 'SIGTERM') {
    this.killed.push(String(sig));
    return true;
  }
  send(m: unknown) {
    this.sent.push(m);
    return true;
  }
  die(code: number | null) {
    this.emit('exit', code);
  }
}

function setup(over: { platform?: NodeJS.Platform; graceMs?: number } = {}) {
  const timers: { fn: () => void; ms: number; id: number; cleared: boolean }[] = [];
  const exits: number[] = [];
  const errors: string[] = [];
  let clock = 0;
  const sup = createSupervisor({
    exit: (c) => exits.push(c),
    graceMs: over.graceMs ?? 11_000,
    platform: over.platform ?? 'linux',
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: timers.length, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean } | undefined) && ((h as { cleared: boolean }).cleared = true);
    },
    now: () => clock,
    logError: (m) => errors.push(m),
  });
  const fire = (t: { fn: () => void; cleared: boolean }) => {
    if (!t.cleared) t.fn();
  };
  return { sup, timers, exits, errors, fire, advance: (ms: number) => (clock += ms) };
}

describe('supervisor', () => {
  it('не перезапускает после кода 3 (onExit вернул false)', () => {
    const { sup, timers } = setup();
    const spawned: FakeChild[] = [];
    sup.supervise('server', () => (spawned[spawned.push(new FakeChild()) - 1]!), { onExit: (c) => c !== 3 });
    spawned[0]!.die(3);
    expect(timers).toHaveLength(0);
    expect(spawned).toHaveLength(1);
  });

  it('перезапускает с задержкой 1 → 2 → 4 с', () => {
    const { sup, timers, fire, errors } = setup();
    const spawned: FakeChild[] = [];
    sup.supervise('server', () => spawned[spawned.push(new FakeChild()) - 1]!);
    spawned[0]!.die(1);
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    fire(timers[0]!);
    spawned[1]!.die(1);
    fire(timers[1]!);
    spawned[2]!.die(1);
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000]);
    expect(spawned).toHaveLength(3);
    expect(errors[0]).toMatch(/перезапуск через 1 с/);
  });

  it('сбрасывает задержку после долгой работы', () => {
    const { sup, timers, fire, advance } = setup();
    const spawned: FakeChild[] = [];
    sup.supervise('server', () => spawned[spawned.push(new FakeChild()) - 1]!);
    spawned[0]!.die(1);
    fire(timers[0]!);
    advance(61_000);
    spawned[1]!.die(1);
    expect(timers.map((t) => t.ms)).toEqual([1000, 1000]);
  });

  it('ошибка запуска (error без pid) считается завершением и ведёт к перезапуску', () => {
    const { sup, timers } = setup();
    const c = new FakeChild();
    c.pid = undefined;
    sup.supervise('x', () => c);
    c.emit('error', new Error('ENOENT'));
    expect(timers).toHaveLength(1);
    c.die(null); // повторное завершение игнорируется
    expect(timers).toHaveLength(1);
  });

  it('shutdown просит сервер остановиться через IPC, ждёт его выхода и только потом выходит', async () => {
    const { sup, exits } = setup();
    const server = new FakeChild();
    const tunnel = new FakeChild();
    sup.supervise('server', () => server, { ipc: true });
    sup.supervise('cloudflared', () => tunnel);
    const p = sup.shutdown(0);
    expect(server.sent).toEqual([{ type: 'shutdown' }]);
    expect(server.killed).toEqual([]);
    expect(tunnel.killed).toEqual(['SIGTERM']);
    expect(exits).toEqual([]);
    server.die(0);
    expect(exits).toEqual([]);
    tunnel.die(0);
    await p;
    expect(exits).toEqual([0]);
    expect(server.killed).toEqual([]);
  });

  it('в Windows при консольном событии не посылает SIGTERM остальным детям', () => {
    const { sup } = setup({ platform: 'win32' });
    const tunnel = new FakeChild();
    sup.supervise('cloudflared', () => tunnel);
    void sup.shutdown(0, { fromConsole: true });
    expect(tunnel.killed).toEqual([]);
  });

  it('по истечении grace принудительно убивает зависших детей и выходит с нужным кодом', async () => {
    const { sup, timers, exits, fire } = setup();
    const server = new FakeChild();
    sup.supervise('server', () => server, { ipc: true });
    const p = sup.shutdown(1);
    const grace = timers.find((t) => t.ms === 11_000)!;
    expect(grace).toBeDefined();
    fire(grace);
    await p;
    expect(server.killed).toEqual(['SIGKILL']);
    expect(exits).toEqual([1]);
  });

  it('после shutdown ничего не запускает и отменяет отложенные перезапуски', () => {
    const { sup, timers, fire } = setup();
    const spawned: FakeChild[] = [];
    sup.supervise('server', () => spawned[spawned.push(new FakeChild()) - 1]!);
    spawned[0]!.die(1);
    const restart = timers[0]!;
    void sup.shutdown(0);
    expect(restart.cleared).toBe(true);
    fire(restart);
    restart.fn(); // даже если таймер всё же сработал, launch проверяет shuttingDown
    expect(spawned).toHaveLength(1);
    sup.supervise('late', () => spawned[spawned.push(new FakeChild()) - 1]!);
    expect(spawned).toHaveLength(1);
  });

  it('shutdown без детей выходит сразу', async () => {
    const { sup, exits } = setup();
    await sup.shutdown(1);
    expect(exits).toEqual([1]);
  });
});
