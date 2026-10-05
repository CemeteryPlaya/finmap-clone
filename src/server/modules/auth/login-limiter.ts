const SWEEP_EVERY = 100;
const SWEEP_SIZE = 1000;

export class LoginLimiter {
  private failures = new Map<string, number[]>();
  /** Проверки пароля, которые уже идут: резервируют попытку до получения результата. */
  private inFlight = new Map<string, number>();
  private calls = 0;

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((ts) => ts > since);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Удаляет ключи без свежих неудач (ключи без резерва в inFlight не хранятся). */
  private maybeSweep(): void {
    if (++this.calls % SWEEP_EVERY !== 0 && this.failures.size <= SWEEP_SIZE) return;
    for (const k of [...this.failures.keys()]) this.recent(k);
  }

  isBlocked(keys: string[]): boolean {
    return keys.some((k) => this.recent(k).length >= this.max);
  }

  /**
   * Резервирует попытку по всем ключам. false — лимит исчерпан с учётом уже идущих проверок.
   * После true обязательно вызвать end(keys, failed).
   */
  tryBegin(keys: string[]): boolean {
    this.maybeSweep();
    if (keys.some((k) => this.recent(k).length + (this.inFlight.get(k) ?? 0) >= this.max)) return false;
    for (const k of keys) this.inFlight.set(k, (this.inFlight.get(k) ?? 0) + 1);
    return true;
  }

  end(keys: string[], failed: boolean): void {
    for (const k of keys) {
      const n = (this.inFlight.get(k) ?? 0) - 1;
      if (n > 0) this.inFlight.set(k, n);
      else this.inFlight.delete(k);
    }
    if (failed) this.recordFailure(keys);
  }

  recordFailure(keys: string[]): void {
    this.maybeSweep();
    for (const k of keys) this.failures.set(k, [...this.recent(k), this.now()]);
  }

  reset(keys: string[]): void {
    for (const k of keys) this.failures.delete(k);
  }

  /** Число отслеживаемых ключей (для тестов и диагностики). */
  size(): number {
    return new Set([...this.failures.keys(), ...this.inFlight.keys()]).size;
  }
}
