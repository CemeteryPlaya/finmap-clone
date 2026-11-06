/**
 * Кто гость (спецификация «Аналитика клуба», §7.1, R17–R19): группа логинов и телефонов, связанных строками Senet
 * (сеансы, пополнения, чеки, абонементы), с ручными правками «Это один гость» и «Разделить».
 */

/** `login:{логин в нижнем регистре}` или `phone:{hash}`; наружу не отдаётся (R25). */
export type GuestKey = string;

/** Логин, у которого больше стольких разных телефонов за `SHARED_WINDOW_DAYS`, — общий (§7.1). */
export const SHARED_LOGIN_PHONES = 3;
export const SHARED_WINDOW_DAYS = 90;

/** Ключ логина: без пробелов по краям, в нижнем регистре (в JS — SQLite не понижает кириллицу); пустой — не ключ. */
export function loginKey(login: string): GuestKey | null {
  const l = login.trim().toLocaleLowerCase('ru');
  return l ? `login:${l}` : null;
}

export function phoneKey(hash: string | null): GuestKey | null {
  return hash ? `phone:${hash}` : null;
}

/** Различная пара «логин — телефон» строк Senet и последнее время, когда она встречалась. */
export interface KeyPair {
  login: string;
  phoneHash: string | null;
  phoneMask: string | null;
  lastAt: string;
}

/** Общие логины (§7.1): больше `SHARED_LOGIN_PHONES` разных телефонов среди пар не старше `since`. */
export function sharedLogins(pairs: readonly KeyPair[], since: string): Set<GuestKey> {
  const phones = new Map<GuestKey, Set<string>>();
  for (const p of pairs) {
    const l = loginKey(p.login);
    if (!l || !p.phoneHash || p.lastAt < since) continue;
    phones.set(l, (phones.get(l) ?? new Set()).add(p.phoneHash));
  }
  return new Set([...phones].filter(([, s]) => s.size > SHARED_LOGIN_PHONES).map(([l]) => l));
}

/** Ручная правка: `merge` — один гость; `split` (`a === b`) — ключ вынут из автоматических связей (R18). */
export interface GuestLink {
  kind: 'merge' | 'split';
  a: GuestKey;
  b: GuestKey;
}

export interface Guests {
  /** Ключ → номер гостя; номера 0…n−1 по возрастанию наименьшего ключа группы. */
  of: Map<GuestKey, number>;
  /** Ключи гостя по номеру, по возрастанию. */
  keys: GuestKey[][];
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Непересекающиеся множества ключей: корень — наименьший ключ. */
class Sets {
  private readonly parent = new Map<GuestKey, GuestKey>();

  add(k: GuestKey): void {
    if (!this.parent.has(k)) this.parent.set(k, k);
  }

  find(k: GuestKey): GuestKey {
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    for (let c = k; c !== root; ) {
      const next = this.parent.get(c)!;
      this.parent.set(c, root);
      c = next;
    }
    return root;
  }

  union(a: GuestKey, b: GuestKey): void {
    const [ra, rb] = [this.find(a), this.find(b)].sort(byKey) as [GuestKey, GuestKey];
    if (ra !== rb) this.parent.set(rb, ra);
  }

  groups(): GuestKey[][] {
    const out = new Map<GuestKey, GuestKey[]>();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      out.set(r, [...(out.get(r) ?? []), k]);
    }
    return [...out.values()].map((ks) => ks.sort(byKey)).sort((a, b) => byKey(a[0]!, b[0]!));
  }
}

/** Ключи пары, которые связывают: общий логин — не ключ. */
function pairKeys(p: KeyPair, shared: ReadonlySet<GuestKey>): GuestKey[] {
  return [loginKey(p.login), phoneKey(p.phoneHash)].filter((k): k is GuestKey => k !== null && !shared.has(k));
}

/**
 * Гости (§7.1): связные компоненты пар «логин — телефон». Вынутый ключ (`split`) не связывается автоматически; `merge`
 * связывает всегда, кроме правок с общим логином.
 */
export function groupGuests(pairs: readonly KeyPair[], shared: ReadonlySet<GuestKey>, links: readonly GuestLink[]): Guests {
  const sets = new Sets();
  const isolated = new Set(links.filter((l) => l.kind === 'split').map((l) => l.a));
  for (const p of pairs) {
    const keys = pairKeys(p, shared);
    keys.forEach((k) => sets.add(k));
    if (keys.length === 2 && !keys.some((k) => isolated.has(k))) sets.union(keys[0]!, keys[1]!);
  }
  for (const l of links.filter((x) => x.kind === 'merge' && !shared.has(x.a) && !shared.has(x.b))) {
    sets.add(l.a);
    sets.add(l.b);
    sets.union(l.a, l.b);
  }
  const keys = sets.groups();
  return { of: new Map(keys.flatMap((ks, i) => ks.map((k) => [k, i] as const))), keys };
}

/** Гость строки (R18, R19): по логину-ключу, иначе по телефону; `shared` — общий логин без телефона; `none` — ни того ни другого. */
export function rowGuest(g: Guests, shared: ReadonlySet<GuestKey>, login: string, phoneHash: string | null): number | 'shared' | 'none' {
  const l = loginKey(login);
  const byLogin = l && !shared.has(l) ? g.of.get(l) : undefined;
  if (byLogin !== undefined) return byLogin;
  const p = phoneKey(phoneHash);
  const byPhone = p ? g.of.get(p) : undefined;
  if (byPhone !== undefined) return byPhone;
  return l && shared.has(l) ? 'shared' : 'none';
}
