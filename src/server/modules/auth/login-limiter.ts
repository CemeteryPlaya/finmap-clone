export class LoginLimiter {
  private failures = new Map<string, number[]>();

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

  isBlocked(keys: string[]): boolean {
    return keys.some((k) => this.recent(k).length >= this.max);
  }

  recordFailure(keys: string[]): void {
    for (const k of keys) this.failures.set(k, [...this.recent(k), this.now()]);
  }

  reset(keys: string[]): void {
    for (const k of keys) this.failures.delete(k);
  }
}
