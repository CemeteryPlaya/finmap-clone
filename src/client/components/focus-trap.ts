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
  /** Лежит во вложенном `<dialog>` (подтверждение поверх формы): у родительского окна Tab на него не попадает. */
  nested?: boolean;
  /** `tabIndex` элемента: меньше нуля (например, `tabindex="-1"`) — Tab на него не попадает. */
  tabIndex?: number;
}

/**
 * Элементы, на которые Tab реально попадает, в порядке обхода: без недоступных, скрытых и с `tabindex` меньше нуля; из группы
 * радиокнопок — только отмеченная, а если отмеченной нет, то первая.
 */
export function tabbable<T extends TabCandidate>(candidates: T[]): T[] {
  const live = candidates.filter((c) => !c.disabled && !c.hidden && !c.nested && !(c.tabIndex !== undefined && c.tabIndex < 0));
  const chosen = new Map<string, T>();
  for (const c of live) {
    if (c.radioGroup === undefined) continue;
    const current = chosen.get(c.radioGroup);
    if (!current || (c.checked && !current.checked)) chosen.set(c.radioGroup, c);
  }
  return live.filter((c) => c.radioGroup === undefined || chosen.get(c.radioGroup) === c);
}

function describe(el: HTMLElement, owner: Element | null): TabCandidate & { el: HTMLElement } {
  const radio = el instanceof HTMLInputElement && el.type === 'radio' ? el : null;
  return {
    el,
    disabled: el.matches(':disabled'),
    hidden: el.getClientRects().length === 0 || !!el.closest('[inert], [hidden]'),
    nested: el.closest('dialog') !== owner,
    radioGroup: radio && radio.name ? `${radio.form ? [...document.forms].indexOf(radio.form) : -1}:${radio.name}` : undefined,
    checked: radio?.checked,
    tabIndex: el.tabIndex,
  };
}

/** Доступные для Tab элементы внутри container, без элементов вложенных окон. */
function tabbableIn(container: HTMLElement): HTMLElement[] {
  const owner = container.closest('dialog');
  return tabbable(Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE), (el) => describe(el, owner))).map((c) => c.el);
}

/** Первый элемент, на который попадёт Tab внутри container (без вложенных окон), или null. */
export function firstTabbable(container: HTMLElement): HTMLElement | null {
  return tabbableIn(container)[0] ?? null;
}

/**
 * Фокус на заголовок `<h1>` страницы (§11 этапа 1.5): когда элемента, к которому надо вернуться, уже нет.
 * Заголовку без `tabindex` ставится `tabindex="-1"`: он принимает фокус, но не попадает в порядок Tab.
 */
export function focusPageHeading(): void {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
}

/**
 * Tab по кругу внутри модального окна (`<dialog>` после showModal() делает страницу недоступной, но Tab
 * с последнего элемента уводит фокус в адресную строку браузера): Tab с последнего доступного элемента —
 * на первый, Shift+Tab с первого — на последний. Вложенные панели (списки с поиском, сохранённые фильтры),
 * которые обработали Tab сами, отменяют событие — его не трогаем. Другие клавиши не обрабатываются.
 */
export function cycleTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || e.defaultPrevented || !root) return;
  const next = tabTarget(tabbableIn(root), document.activeElement, root, e.shiftKey);
  if (!next) return;
  e.preventDefault();
  next.focus();
}

/**
 * Куда перевести фокус при Tab по кругу, или null — оставить Tab браузеру. Краем считается и само окно
 * (`active === root`: фокус на `<dialog>`, пока форма грузится): Tab — на первый элемент, Shift+Tab — на последний.
 */
export function tabTarget<T>(items: T[], active: unknown, root: unknown, shift: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (active === root || active === (shift ? first : last)) return shift ? last : first;
  return null;
}
