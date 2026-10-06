/** Регистронезависимое сравнение для кириллицы: нижний регистр по правилам ru и «ё» → «е» (§6.1). */
export function foldCase(value: string): string {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

/** Текст содержит запрос (без учёта регистра и «ё»); пустой запрос подходит всем. */
export function matchesQuery(text: string, query: string): boolean {
  const q = foldCase(query.trim());
  return q === '' || foldCase(text).includes(q);
}
