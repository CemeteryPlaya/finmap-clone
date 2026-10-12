import { damaged } from './errors';

/**
 * Безопасный потоковый разбор XML (§3.2 спецификации импорта): один проход через indexOf, без рекурсии и без дерева.
 * DOCTYPE и ENTITY запрещены целиком (XXE и «billion laughs» невозможны): раскрываются только пять стандартных
 * сущностей и числовые ссылки. Имена элементов — без префикса пространства имён; атрибуты — как в файле (`r:id`).
 */
export interface XmlHandler {
  open(name: string, attrs: Record<string, string>): void;
  text(value: string): void;
  close(name: string): void;
}

export interface XmlLimits {
  /** Глубина вложенности (64). */
  maxDepth?: number;
  /** Атрибутов у элемента (64). */
  maxAttrs?: number;
}

export const XML_MAX_DEPTH = 64;
export const XML_MAX_ATTRS = 64;
/** Начальный тег и инструкция обработки — не длиннее 64 КБ: разбор атрибутов линейный, но огромный тег — признак атаки. */
export const XML_MAX_TAG = 64 * 1024;

const NAMED = new Map<string, string>([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);
/** Пробельные символы XML: пробел, табуляция, CR, LF. */
const isSpace = (c: number) => c === 32 || c === 9 || c === 13 || c === 10;

/** Имя без префикса пространства имён: `x:row` → `row`. */
const local = (name: string) => {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
};

/** Текст с раскрытыми ссылками: только &lt; &gt; &amp; &quot; &apos; и &#N; / &#xH; (не управляющий символ, не суррогат, не больше U+10FFFF). */
export function decodeXmlText(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,30});|&/g, (whole, ref: string | undefined) => {
    if (ref === undefined) throw damaged('неверная ссылка на символ');
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if ((code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff || code > 0x10ffff) throw damaged(`недопустимая ссылка на символ ${whole}`);
      return String.fromCodePoint(code);
    }
    const named = NAMED.get(ref);
    if (named === undefined) throw damaged(`неизвестная сущность ${whole}`);
    return named;
  });
}

/**
 * Атрибуты начального тега: `имя = "значение"` или `имя = 'значение'` через пробелы. Сканер на indexOf — один проход
 * без возвратов (регулярное выражение с matchAll на огромном теге работало бы квадратично). Что-то иное — F3.
 */
export function parseAttributes(body: string, maxAttrs: number): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null);
  const n = body.length;
  let count = 0;
  let i = 0;
  for (;;) {
    while (i < n && isSpace(body.charCodeAt(i))) i++;
    if (i >= n) return attrs;
    const eq = body.indexOf('=', i);
    if (eq < 0) throw damaged('неверный атрибут XML');
    let nameEnd = eq;
    while (nameEnd > i && isSpace(body.charCodeAt(nameEnd - 1))) nameEnd--;
    const name = body.slice(i, nameEnd);
    if (name === '' || /[\s"'<>/=]/.test(name)) throw damaged('неверный атрибут XML');
    let q = eq + 1;
    while (q < n && isSpace(body.charCodeAt(q))) q++;
    const quote = body[q];
    if (quote !== '"' && quote !== "'") throw damaged('неверный атрибут XML');
    const end = body.indexOf(quote, q + 1);
    if (end < 0) throw damaged('неверный атрибут XML');
    if (name in attrs) throw damaged('повторяющийся атрибут XML');
    if (++count > maxAttrs) throw damaged('слишком много атрибутов у элемента');
    attrs[name] = decodeXmlText(body.slice(q + 1, end));
    i = end + 1;
  }
}

export function scanXml(xml: string, h: XmlHandler, limits: XmlLimits = {}): void {
  const maxDepth = limits.maxDepth ?? XML_MAX_DEPTH;
  const maxAttrs = limits.maxAttrs ?? XML_MAX_ATTRS;
  // сущности не объявляются и не раскрываются: любой DOCTYPE или ENTITY — отказ сразу, до разбора
  if (/<!\s*(?:doctype|entity)/i.test(xml)) throw damaged('объявления DOCTYPE и ENTITY запрещены');

  const stack: string[] = [];
  let roots = 0;
  const n = xml.length;
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      if (stack.length > 0) h.text(decodeXmlText(xml.slice(i, textEnd)));
      else if (/[^ \t\r\n]/.test(xml.slice(i, textEnd))) throw damaged('текст вне корневого элемента XML');
    }
    if (lt < 0) break;

    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw damaged('XML оборван');
      if (end - lt > XML_MAX_TAG) throw damaged('слишком длинный тег XML');
      if (xml.startsWith('<?xml', lt)) {
        const enc = /encoding\s*=\s*["']([^"']+)["']/.exec(xml.slice(lt, end));
        if (enc && !/^utf-?8$/i.test(enc[1]!)) throw damaged(`кодировка ${enc[1]} не поддерживается`);
      }
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw damaged('XML оборван');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw damaged('XML оборван');
      if (stack.length === 0) throw damaged('текст вне корневого элемента XML');
      h.text(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) throw damaged('объявления <!…> запрещены');

    if (xml.charCodeAt(lt + 1) === 47 /* / */) {
      const end = xml.indexOf('>', lt + 2);
      if (end < 0) throw damaged('XML оборван');
      const qname = xml.slice(lt + 2, end).trim();
      if (stack.pop() !== qname) throw damaged('теги XML не совпадают');
      h.close(local(qname));
      i = end + 1;
      continue;
    }

    // начальный тег: конец — первый «>» вне кавычек; не длиннее XML_MAX_TAG
    let j = lt + 1;
    let quote = 0;
    for (; j < n; j++) {
      if (j - lt > XML_MAX_TAG) throw damaged('слишком длинный тег XML');
      const c = xml.charCodeAt(j);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) quote = c;
      else if (c === 62) break;
    }
    if (j >= n) throw damaged('XML оборван');
    let body = xml.slice(lt + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const m = /^[^\s/>]+/.exec(body);
    if (!m) throw damaged('неверный тег XML');
    const qname = m[0];
    const name = local(qname);
    if (stack.length === 0 && ++roots > 1) throw damaged('несколько корневых элементов XML');
    const attrs = parseAttributes(body.slice(m[0].length), maxAttrs);
    if (!selfClosing) {
      stack.push(qname);
      if (stack.length > maxDepth) throw damaged('слишком глубокая вложенность XML');
    } else if (stack.length + 1 > maxDepth) throw damaged('слишком глубокая вложенность XML');
    h.open(name, attrs);
    if (selfClosing) h.close(name);
    i = j + 1;
  }
  if (stack.length > 0) throw damaged('XML оборван');
}
