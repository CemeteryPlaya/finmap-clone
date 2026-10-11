import { foldCase, matchesQuery } from '../../shared/search';

/** Пункт выпадающего списка формы и окон журнала (§6.6 этапа 1.5). */
export interface PickerOption {
  id: number;
  label: string;
  /** Заголовок группы: показывается перед первым вариантом группы (например, «Сотрудники»). */
  section?: string;
  /** Бейдж после названия — «системная» у системной категории. Только для глаз: имя пункта — label. */
  badge?: string;
  /** Текст справа — символ валюты у счёта. Только для глаз: имя пункта — label. */
  suffix?: string;
}

export type PickerItem = { kind: 'option'; option: PickerOption } | { kind: 'create'; name: string };

/**
 * Пункты списка с поиском (§6.6 этапа 1.5): варианты, подходящие под запрос (без учёта регистра и «ё», тем же правилом,
 * что сервер), и с `createNoun` — пункт «+ Создать»: при пустом запросе первым («+ Создать категорию», снимок Finmap 11),
 * с текстом — после найденных («+ Создать „аре“», снимок 09b), если такого названия ещё нет.
 */
export function pickerItems(options: readonly PickerOption[], query: string, createNoun?: string): PickerItem[] {
  const name = query.trim();
  const shown: PickerItem[] = options.filter((o) => matchesQuery(o.label, name)).map((option) => ({ kind: 'option', option }));
  if (createNoun === undefined) return shown;
  if (name === '') return [{ kind: 'create', name: '' }, ...shown];
  const exists = options.some((o) => foldCase(o.label) === foldCase(name));
  return exists ? shown : [...shown, { kind: 'create', name }];
}

/** Подпись пункта «+ Создать»: без названия — «+ Создать категорию», с названием — «+ Создать „Аренда“». */
export function createItemLabel(name: string, noun: string): string {
  return name === '' ? `+ Создать ${noun}` : `+ Создать „${name}“`;
}

/**
 * Активный пункт при открытии списка и после нового запроса: выбранный (решение 6a R1), иначе первый вариант —
 * не «+ Создать»: Enter после печати выбирает найденное. Если вариантов нет — первый пункт («+ Создать „…“»).
 */
export function initialActive(items: readonly PickerItem[], selectedId: number | null | undefined): number {
  const selected = items.findIndex((it) => it.kind === 'option' && it.option.id === selectedId);
  if (selected >= 0) return selected;
  const first = items.findIndex((it) => it.kind === 'option');
  return first >= 0 ? first : 0;
}
