import { describe, expect, it } from 'vitest';
import { contentDisposition } from '../../src/server/http/content-disposition';

describe('contentDisposition', () => {
  it('русское имя — ASCII-запас и полное имя в UTF-8', () => {
    expect(contentDisposition('Журнал.xlsx')).toBe("attachment; filename=\"______.xlsx\"; filename*=UTF-8''%D0%96%D1%83%D1%80%D0%BD%D0%B0%D0%BB.xlsx");
  });

  it('одиночный суррогат не бросает URIError: заменяется на U+FFFD', () => {
    expect(() => contentDisposition('a\uD800b.xlsx')).not.toThrow();
    expect(contentDisposition('a\uD800b\uDC00.xlsx')).toContain("filename*=UTF-8''a%EF%BF%BDb%EF%BF%BD.xlsx");
    expect(contentDisposition('\u{1F389}.xlsx')).toContain('%F0%9F%8E%89.xlsx');
  });
});
