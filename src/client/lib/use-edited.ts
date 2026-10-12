import { useRef } from 'react';

/** Что открыто в окне правки списка настроек: 'new' — создание, id — правка, null — окно закрыто. */
export type EditingId = number | 'new' | null;

/**
 * Чистая часть useEditedItem: last — элемент, найденный в прошлый раз. Найден в списке — он; нет — последний
 * найденный с тем же id (снимок), а gone = true: в списке его уже нет.
 */
export function editedItem<T extends { id: number }>(
  last: T | null,
  list: readonly T[] | undefined,
  editing: EditingId,
): { item: T | null; gone: boolean } {
  if (typeof editing !== 'number') return { item: null, gone: false };
  const found = list?.find((x) => x.id === editing) ?? null;
  return { item: found ?? (last?.id === editing ? last : null), gone: found === null };
}

/**
 * Окно правки по id (R5 плана 1.5-4b): свежие данные из списка; последний найденный элемент живёт, пока окно открыто,
 * gone — его уже нет в списке. Окно показывает «… не найден» только при gone и без своего запроса в пути: после своего
 * архива или удаления список может обновиться на кадр раньше, чем окно закроется.
 */
export function useEditedItem<T extends { id: number }>(list: readonly T[] | undefined, editing: EditingId): { item: T | null; gone: boolean } {
  const last = useRef<T | null>(null);
  const edited = editedItem(last.current, list, editing);
  last.current = edited.item;
  return edited;
}

/**
 * Пока hold — прежнее значение: окно во время своего запроса показывает элемент таким, каким он был при нажатии
 * (без вспышки «В архиве» после «В архив» или формы после «Вернуть из архива» перед закрытием).
 */
export function useHeldWhile<T>(value: T, hold: boolean): T {
  const held = useRef(value);
  if (!hold) held.current = value;
  return held.current;
}
