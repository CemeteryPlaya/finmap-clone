/** Content-Disposition по RFC 6266/8187: ASCII-запасное имя и полное имя в UTF-8 (кодируются и символы '()*). */
export function contentDisposition(name: string): string {
  // одиночный суррогат encodeURIComponent не принимает (URIError) — заменяем на U+FFFD
  name = name.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
