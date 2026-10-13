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
  /** Недоступен (aria-disabled): виден в списке, но не выбирается («Создать новый счёт» в импорте, R4 плана И-2). */
  disabled?: boolean;
}

/** «+ Создать» списка: `onCreate` и `createNoun` («категорию») передаются только вместе. */
export type CreateProps<R = void> = { onCreate?: undefined; createNoun?: undefined } | { onCreate: (name: string) => R; createNoun: string };

/** `onCreate` с `createNoun` или ни того ни другого — для передачи дальше в виде `{...createProps(props)}`. */
export function createProps<R>(p: CreateProps<R>): CreateProps<R> {
  return p.onCreate ? { onCreate: p.onCreate, createNoun: p.createNoun } : {};
}

export type PickerItem = { kind: 'option'; option: PickerOption } | { kind: 'create'; name: string };

/**
 * Пункты списка с поиском (§6.6 этапа 1.5): варианты, подходящие под запрос (без учёта регистра и «ё», тем же правилом,
 * что сервер), и с `createNoun` — пункт «+ Создать»: при пустом запросе первым («+ Создать категорию», снимок Finmap 11),
 * с текстом — после найденных («+ Создать категорию „аре“», снимок 09b), если такого названия ещё нет.
 */
export function pickerItems(options: readonly PickerOption[], query: string, createNoun?: string): PickerItem[] {
  const name = query.trim();
  const shown: PickerItem[] = options.filter((o) => matchesQuery(o.label, name)).map((option) => ({ kind: 'option', option }));
  if (createNoun === undefined) return shown;
  if (name === '') return [{ kind: 'create', name: '' }, ...shown];
  const exists = options.some((o) => foldCase(o.label) === foldCase(name));
  return exists ? shown : [...shown, { kind: 'create', name }];
}

/** Подпись пункта «+ Создать»: без названия — «+ Создать категорию», с названием — «+ Создать категорию „Аренда“» (снимок Finmap 09b). */
export function createItemLabel(name: string, noun: string): string {
  return name === '' ? `+ Создать ${noun}` : `+ Создать ${noun} „${name}“`;
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

/**
 * Запрос поиска по правке закрытого поля: новое значение сравнивается с показанным названием — общее начало и
 * общий конец отбрасываются, середина и есть запрос. Верно для печати, перекомпоновки IME («Аренда» → «Арендаи» даёт «и»),
 * стирания («Арен» даёт ''), вырезания, вставки и автозамены — не зависит от `InputEvent.data` (его нет у части клавиатур телефонов).
 */
export function typedQuery(shown: string, next: string): string {
  const max = Math.min(shown.length, next.length);
  let head = 0;
  while (head < max && shown[head] === next[head]) head++;
  let tail = 0;
  while (tail < max - head && shown[shown.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  return next.slice(head, next.length - tail);
}

/**
 * Запрос закрытого поля с выбранным значением по событию ввода. Всё название выделено (Tab в поле, «выделить всё»)
 * и вводится текст — запрос он сам (по разнице «А» поверх «Аренда» потерялась бы). Обычная вставка текста — `data`.
 * Остальное — удаление, вырезание, перекомпоновка клавиатуры телефона (у неё `data` пуст или несёт всё слово) —
 * разница с названием (`typedQuery`).
 */
export function pickQuery(e: { shown: string; next: string; data: string | null; inputType: string; selectedAll: boolean }): string {
  const insert = e.inputType.startsWith('insert');
  const composing = e.inputType === 'insertCompositionText';
  if (insert && e.selectedAll) return composing ? e.next : (e.data ?? e.next);
  if (insert && !composing && e.data !== null) return e.data;
  return typedQuery(e.shown, e.next);
}
