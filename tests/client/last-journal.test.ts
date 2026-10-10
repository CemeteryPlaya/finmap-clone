import { describe, expect, it } from 'vitest';
import { journalBackHref, lastJournalKey } from '../../src/client/lib/last-journal';

describe('«← Назад к журналу» (§4.1 этапа 1.5)', () => {
  it('ключ sessionStorage — на компанию', () => {
    expect(lastJournalKey(5)).toBe('fc.lastJournal.5');
  });

  it('сохранённая строка запроса журнала возвращается целиком', () => {
    expect(journalBackHref(5, '?period=month&account=3')).toBe('/c/5/log?period=month&account=3');
    expect(journalBackHref(5, '?q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0')).toBe('/c/5/log?q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0');
  });

  it('нет сохранённого адреса, пустой или чужой вид — просто журнал компании', () => {
    for (const saved of [null, '', '?', '//evil.example', 'https://evil.example/?x=1', '/c/7/log?x=1', '?a=1#frag', 'period=month']) {
      expect(journalBackHref(5, saved), String(saved)).toBe('/c/5/log');
    }
  });
});
