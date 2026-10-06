import { AppError } from '../../errors';

/** Новый порядок содержит ровно те же элементы без повторов; иначе список устарел (кто-то добавил, удалил или перенёс элемент). */
export function assertSameSet(current: readonly number[], ids: readonly number[]): void {
  const want = new Set(current);
  if (new Set(ids).size !== ids.length || ids.length !== want.size || ids.some((id) => !want.has(id))) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Список изменился — обновите страницу и повторите');
  }
}

/** Порядок не изменился — запись и история не нужны. */
export function isSameOrder(current: readonly number[], ids: readonly number[]): boolean {
  return current.length === ids.length && current.every((id, i) => id === ids[i]);
}
