import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { decodeXmlText, scanXml } from '../../src/server/modules/imports/xml';

/** События разбора одной строкой: «<a x=1>», «текст», «</a>». */
function events(xml: string, limits?: { maxDepth?: number; maxAttrs?: number }): string[] {
  const out: string[] = [];
  scanXml(
    xml,
    {
      open: (name, attrs) => out.push(`<${name}${Object.entries(attrs).map(([k, v]) => ` ${k}=${v}`).join('')}>`),
      text: (v) => out.push(v),
      close: (name) => out.push(`</${name}>`),
    },
    limits,
  );
  return out;
}

function f3(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: 'F3' });
    return (e as AppError).message;
  }
  throw new Error('ожидалась F3');
}

describe('XML: безопасный разбор (§3.2 спецификации импорта)', () => {
  it('элементы, атрибуты в двойных и одинарных кавычках, «>» внутри значения, самозакрывающиеся, префиксы пространств имён', () => {
    expect(events(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<x:a xmlns:x="u" r:id='rId1' v="a>b"><b/>т<c>к</c></x:a>`)).toEqual([
      '<a xmlns:x=u r:id=rId1 v=a>b>',
      '<b>',
      '</b>',
      'т',
      '<c>',
      'к',
      '</c>',
      '</a>',
    ]);
  });

  it('стандартные и числовые сущности; CDATA как есть; комментарии и инструкции пропускаются; BOM в начале', () => {
    expect(events('\uFEFF<a q="&quot;&#x41;">&lt;&gt;&amp;&quot;&apos;&#1044;&#x1F389;<!-- <b>x</b> --><?pi x?><![CDATA[&lt;<b>]]></a>')).toEqual([
      '<a q="A>',
      '<>&"\'Д\u{1F389}',
      '&lt;<b>',
      '</a>',
    ]);
    expect(decodeXmlText('без ссылок')).toBe('без ссылок');
  });

  it('DOCTYPE, ENTITY (в том числе после BOM и в нижнем регистре) и «billion laughs» отклоняются сразу (Review Focus)', () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`;
    const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`;
    for (const xml of [laughs, xxe, '\uFEFF<!DOCTYPE a><a/>', '<a><!entity x "y"></a>', '<!doctype a><a/>']) {
      let called = 0;
      expect(f3(() => scanXml(xml, { open: () => called++, text: () => called++, close: () => called++ }))).toBe(
        'Файл повреждён или небезопасен: объявления DOCTYPE и ENTITY запрещены',
      );
      expect(called).toBe(0);
    }
  });

  it('неизвестная сущность, «&» без ссылки, ссылки на 0, суррогат и больше U+10FFFF — F3', () => {
    expect(f3(() => events('<a>&nbsp;</a>'))).toBe('Файл повреждён или небезопасен: неизвестная сущность &nbsp;');
    expect(f3(() => events('<a>a & b</a>'))).toContain('неверная ссылка на символ');
    expect(f3(() => events('<a b="&x;"/>'))).toContain('неизвестная сущность &x;');
    for (const ref of ['&#0;', '&#xD800;', '&#xDFFF;', '&#x110000;', '&#1114112;']) expect(f3(() => decodeXmlText(ref)), ref).toContain('недопустимая ссылка');
  });

  it('глубина 64 — можно, 65 — F3; атрибутов больше 64 — F3', () => {
    const nest = (n: number) => '<a>'.repeat(n) + '</a>'.repeat(n);
    expect(events(nest(64))).toHaveLength(128);
    expect(f3(() => events(nest(65)))).toBe('Файл повреждён или небезопасен: слишком глубокая вложенность XML');
    expect(f3(() => events(`${'<a>'.repeat(64)}<b/>${'</a>'.repeat(64)}`))).toContain('вложенность');
    const attrs = (n: number) => `<a ${Array.from({ length: n }, (_, i) => `x${i}="1"`).join(' ')}/>`;
    expect(events(attrs(64))).toHaveLength(2);
    expect(f3(() => events(attrs(65)))).toContain('слишком много атрибутов');
  });

  it('не UTF-8 в объявлении, несовпадающие и незакрытые теги, оборванный комментарий — F3', () => {
    expect(f3(() => events('<?xml version="1.0" encoding="windows-1251"?><a/>'))).toBe('Файл повреждён или небезопасен: кодировка windows-1251 не поддерживается');
    expect(events('<?xml version="1.0" encoding="utf8"?><a/>')).toEqual(['<a>', '</a>']);
    expect(f3(() => events('<a><b></a></b>'))).toContain('не совпадают');
    expect(f3(() => events('<a><b>'))).toContain('оборван');
    expect(f3(() => events('<a><!-- </a>'))).toContain('оборван');
    expect(f3(() => events('<a x="1></a>'))).toContain('оборван');
  });

  it('огромный начальный тег (1 МБ символов атрибутов) — F3 быстро, без квадратичного разбора; мусор в атрибутах — F3 (Review Focus)', () => {
    const t0 = performance.now();
    expect(f3(() => events(`<a ${'x'.repeat(1_000_000)}/>`))).toBe('Файл повреждён или небезопасен: слишком длинный тег XML');
    expect(f3(() => events(`<a ${'x="1" '.repeat(200_000)}/>`))).toContain('слишком длинный тег XML');
    expect(f3(() => events(`<?xml version="1.0" ${'encoding="'.repeat(100_000)}?><a/>`))).toContain('слишком длинный тег XML');
    // под пределом 64 КБ: атрибут без «=» или без кавычек — отказ за один проход
    expect(f3(() => events(`<a ${'x'.repeat(60_000)}/>`))).toBe('Файл повреждён или небезопасен: неверный атрибут XML');
    expect(f3(() => events('<a b=1/>'))).toContain('неверный атрибут XML');
    expect(f3(() => events('<a b c="1"/>'))).toContain('неверный атрибут XML');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(events(`<a  b = "1"\tc='2'/>`)).toEqual(['<a b=1 c=2>', '</a>']);
  });
});
