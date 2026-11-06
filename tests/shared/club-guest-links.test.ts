import { describe, expect, it } from 'vitest';
import { groupGuests, loginKey, phoneKey, rowGuest, sharedLogins, type GuestLink, type KeyPair } from '../../src/shared/club-analytics/guest-links';

const AT = '2026-11-05T10:00:00.000Z';
const SINCE = '2026-08-07T00:00:00.000Z';
const pair = (login: string, hash: string | null, lastAt = AT): KeyPair => ({ login, phoneHash: hash, phoneMask: hash ? `+7 *** ** ${hash.slice(1)}` : null, lastAt });

function group(pairs: KeyPair[], links: GuestLink[] = []) {
  const shared = sharedLogins(pairs, SINCE);
  return { g: groupGuests(pairs, shared, links), shared };
}

describe('ключи гостя', () => {
  it('логин — без пробелов и в нижнем регистре, кириллица тоже; пустой — не ключ', () => {
    expect(loginKey(' Ivan ')).toBe('login:ivan');
    expect(loginKey('ivan')).toBe('login:ivan');
    expect(loginKey('ИВАН')).toBe('login:иван');
    expect(loginKey('  ')).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey('h1')).toBe('phone:h1');
  });
});

describe('groupGuests', () => {
  it('логин с двумя телефонами — один гость', () => {
    const { g } = group([pair('a', 'h1'), pair('a', 'h2')]);
    expect(g.keys).toEqual([['login:a', 'phone:h1', 'phone:h2']]);
  });

  it('телефон с двумя логинами — один гость', () => {
    const { g } = group([pair('a', 'h1'), pair('B', 'h1')]);
    expect(g.keys).toEqual([['login:a', 'login:b', 'phone:h1']]);
  });

  it('цепочка из трёх логинов — один гость', () => {
    const { g } = group([pair('a', 'h1'), pair('b', 'h1'), pair('b', 'h2'), pair('c', 'h2')]);
    expect(g.keys).toHaveLength(1);
    expect(g.keys[0]).toHaveLength(5);
  });

  it('общий логин с 4 телефонами не связывает; его строки — гостю телефона или «общие»', () => {
    const pairs = ['h1', 'h2', 'h3', 'h4'].map((h) => pair('guest', h));
    const { g, shared } = group(pairs);
    expect(shared).toEqual(new Set(['login:guest']));
    expect(g.keys).toEqual([['phone:h1'], ['phone:h2'], ['phone:h3'], ['phone:h4']]);
    expect(rowGuest(g, shared, 'guest', 'h2')).toBe(g.of.get('phone:h2'));
    expect(rowGuest(g, shared, 'guest', null)).toBe('shared');
  });

  it('телефоны общего логина старше 90 дней не считаются', () => {
    const old = '2026-07-01T00:00:00.000Z';
    const { g, shared } = group([pair('guest', 'h1'), pair('guest', 'h2'), pair('guest', 'h3', old), pair('guest', 'h4', old)]);
    expect(shared.size).toBe(0);
    expect(g.keys).toHaveLength(1);
  });

  it('ручное «Разделить» сильнее автоматической связи и новых пар', () => {
    const split: GuestLink = { kind: 'split', a: 'phone:h1', b: 'phone:h1' };
    const { g, shared } = group([pair('a', 'h1'), pair('b', 'h1'), pair('c', 'h1')], [split]);
    expect(g.keys).toEqual([['login:a'], ['login:b'], ['login:c'], ['phone:h1']]);
    expect(rowGuest(g, shared, 'a', 'h1')).toBe(g.of.get('login:a'));
  });

  it('«Это один гость» после «Разделить» связывает снова', () => {
    const links: GuestLink[] = [
      { kind: 'split', a: 'phone:h1', b: 'phone:h1' },
      { kind: 'merge', a: 'login:a', b: 'phone:h1' },
    ];
    const { g } = group([pair('a', 'h1'), pair('b', 'h1')], links);
    expect(g.keys).toEqual([['login:a', 'phone:h1'], ['login:b']]);
  });

  it('«Это один гость» связывает логины без общего телефона', () => {
    const { g } = group([pair('a', 'h1'), pair('b', 'h2')], [{ kind: 'merge', a: 'login:a', b: 'login:b' }]);
    expect(g.keys).toEqual([['login:a', 'login:b', 'phone:h1', 'phone:h2']]);
  });

  it('правка с общим логином не действует', () => {
    const pairs = ['h1', 'h2', 'h3', 'h4'].map((h) => pair('guest', h));
    const { g } = group([...pairs, pair('a', 'h9')], [{ kind: 'merge', a: 'login:a', b: 'login:guest' }]);
    expect(g.of.has('login:guest')).toBe(false);
    expect(g.keys.find((k) => k.includes('login:a'))).toEqual(['login:a', 'phone:h9']);
  });

  it('строка без логина и телефона — без гостя', () => {
    const { g, shared } = group([pair('a', 'h1')]);
    expect(rowGuest(g, shared, '', null)).toBe('none');
    expect(rowGuest(g, shared, '', 'h1')).toBe(g.of.get('phone:h1'));
  });

  it('номера гостей — по возрастанию наименьшего ключа', () => {
    const { g } = group([pair('b', 'h2'), pair('a', 'h1')]);
    expect(g.of.get('login:a')).toBe(0);
    expect(g.of.get('login:b')).toBe(1);
  });
});
