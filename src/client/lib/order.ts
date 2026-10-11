/**
 * Полный порядок после перестановки видимой части (§7.1 этапа 1.5): строки subset занимают в full свои прежние
 * места, но в новом порядке; остальные (другая вкладка, архивные) не двигаются. id не из full и повторы пропускаются.
 */
export function mergeSubsetOrder(full: readonly number[], subset: readonly number[]): number[] {
  const known = new Set(full);
  const queue = [...new Set(subset)].filter((id) => known.has(id));
  const moving = new Set(queue);
  return full.map((id) => (moving.has(id) ? queue.shift()! : id));
}

/** Список в порядке ids (оптимистичный порядок в кэше); не названные — в конце в прежнем порядке. */
export function sortByIds<T extends { id: number }>(list: readonly T[], ids: readonly number[]): T[] {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const at = (id: number) => pos.get(id) ?? ids.length;
  return [...list].sort((a, b) => at(a.id) - at(b.id));
}
