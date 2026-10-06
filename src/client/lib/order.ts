/**
 * Новый порядок полного списка ids после сдвига id на одну позицию внутри группы `group`
 * (например, счета одного проекта). null — двигать некуда.
 */
export function moveWithinGroup(ids: readonly number[], group: readonly number[], id: number, delta: -1 | 1): number[] | null {
  const gi = group.indexOf(id);
  const neighbor = group[gi + delta];
  if (gi < 0 || neighbor === undefined) return null;
  const out = [...ids];
  const a = out.indexOf(id);
  const b = out.indexOf(neighbor);
  if (a < 0 || b < 0) return null;
  out[a] = neighbor;
  out[b] = id;
  return out;
}
