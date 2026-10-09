import type { KeyboardEvent } from 'react';

const FOCUSABLE = 'input, button, textarea, select, [tabindex="0"], a[href]';

/** Что про элемент известно для выбора «куда попадёт Tab» (отдельно от DOM, чтобы проверять без браузера). */
export interface TabCandidate {
  /** Недоступен: `:disabled` (в том числе внутри `fieldset[disabled]`). */
  disabled: boolean;
  /** Не показан на экране или внутри `inert`. */
  hidden: boolean;
  /** Для радиокнопки — ключ группы (форма и имя); у остальных элементов не задан. */
  radioGroup?: string;
  checked?: boolean;
}

/**
 * Элементы, на которые Tab реально попадает, в порядке обхода: без недоступных и скрытых; из группы
 * радиокнопок — только отмеченная, а если отмеченной нет, то первая.
 */
export function tabbable<T extends TabCandidate>(candidates: T[]): T[] {
  const live = candidates.filter((c) => !c.disabled && !c.hidden);
  const chosen = new Map<string, T>();
  for (const c of live) {
    if (c.radioGroup === undefined) continue;
    const current = chosen.get(c.radioGroup);
    if (!current || (c.checked && !current.checked)) chosen.set(c.radioGroup, c);
  }
  return live.filter((c) => c.radioGroup === undefined || chosen.get(c.radioGroup) === c);
}

function describe(el: HTMLElement): TabCandidate & { el: HTMLElement } {
  const radio = el instanceof HTMLInputElement && el.type === 'radio' ? el : null;
  return {
    el,
    disabled: el.matches(':disabled'),
    hidden: el.getClientRects().length === 0 || !!el.closest('[inert], [hidden]'),
    radioGroup: radio && radio.name ? `${radio.form ? [...document.forms].indexOf(radio.form) : -1}:${radio.name}` : undefined,
    checked: radio?.checked,
  };
}

/**
 * Tab по кругу внутри модального окна (`<dialog>` после showModal() делает страницу недоступной, но Tab
 * с последнего элемента уводит фокус в адресную строку браузера): Tab с последнего доступного элемента —
 * на первый, Shift+Tab с первого — на последний. Вложенные панели (списки с поиском, сохранённые фильтры),
 * которые обработали Tab сами, отменяют событие — его не трогаем. Другие клавиши не обрабатываются.
 */
export function cycleTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || e.defaultPrevented || !root) return;
  const items = tabbable(Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE), describe)).map((c) => c.el);
  if (items.length === 0) return;
  const edge = e.shiftKey ? items[0] : items[items.length - 1];
  if (document.activeElement !== edge) return;
  e.preventDefault();
  (e.shiftKey ? items[items.length - 1] : items[0])!.focus();
}
