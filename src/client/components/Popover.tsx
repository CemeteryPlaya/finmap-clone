import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FieldControlProps } from './Field';
import { btnSmall } from './ui';
import { useFloating } from './useFloating';

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"], a[href]';

/** Стрелка ▾ на кнопке Popover: при открытой панели переворачивается (▴); для чтения с экрана скрыта. */
export function Caret() {
  return (
    <span aria-hidden="true" className="inline-block group-aria-expanded:rotate-180">
      ▾
    </span>
  );
}

/**
 * Всплывающая панель у кнопки: кнопка с aria-haspopup и aria-expanded, панель — немодальный role="dialog".
 * Панель рисуется порталом в body (position: fixed), поэтому её не обрезают контейнеры с прокруткой
 * (обёртка таблицы журнала). При открытии фокус — на элементе с `data-autofocus` (активный день календаря),
 * иначе на первом элементе панели; Esc закрывает и возвращает фокус на кнопку; клик мимо и уход фокуса
 * из кнопки и панели закрывают её.
 * Панель в DOM стоит вне кнопки, поэтому порядок Tab замкнут вручную: Tab с кнопки ведёт в панель,
 * Shift+Tab с первого элемента панели — на кнопку, Tab за последним элементом закрывает панель
 * и возвращает фокус на кнопку.
 * Вложенная панель (календарь поля даты в меню периода, §6.5 этапа 1.5) рисуется внутри родительской
 * (`data-popover-panel`), а в модальном окне — в самом `<dialog>`: для родительской она «своя» — щелчок и фокус
 * в ней родительскую не закрывают; клавиши, которые вложенная панель уже обработала (Esc, Tab на краю),
 * родительская не трогает; первый и последний элемент для Tab и начальный фокус родительская считает только
 * по своим элементам.
 * children получает close(returnFocus) — закрыть панель после выбора.
 */
export function Popover(props: {
  /** Видимая подпись кнопки. */
  label: ReactNode;
  /** Доступное имя кнопки и панели, если подпись — не текст или нужна другая. */
  ariaLabel?: string;
  buttonClassName?: string;
  /** Выравнивание панели по кнопке. */
  align?: 'left' | 'right';
  panelClassName?: string;
  disabled?: boolean;
  /** id и aria-атрибуты поля формы (`Field`): подпись `<label for>`, подсказка и ошибка связываются с кнопкой. */
  control?: FieldControlProps;
  /** Название панели, если оно не совпадает с именем кнопки. */
  panelLabel?: string;
  /**
   * Кнопка недоступна, но остаётся в порядке фокуса (aria-disabled, щелчок не открывает панель): фокус,
   * вернувшийся на неё после выбора, не теряется, пока идёт начатое действие.
   */
  inactive?: boolean;
  children: (close: (returnFocus?: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const style = useFloating(open, buttonRef, panelRef, props.align);
  // до расчёта места панель невидима, а в невидимый элемент фокус не переходит
  const placed = open && style.visibility !== 'hidden';
  const name = props.panelLabel ?? props.ariaLabel ?? (typeof props.label === 'string' ? props.label : undefined);

  /** Узел — внутри кнопки или панели (панель не внутри rootRef: она в портале). */
  const inside = (node: Node | null) => !!node && (!!rootRef.current?.contains(node) || !!panelRef.current?.contains(node));
  /** Свой элемент панели, а не вложенной (календарь поля даты): у вложенной панели свой порядок Tab. */
  const own = (el: Element) => el.closest('[data-popover-panel]') === panelRef.current;
  const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(own);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!placed) return;
    const auto = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-autofocus]') ?? []).find(own);
    (auto ?? focusable()[0])?.focus();
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!inside(e.target as Node)) setOpen(false);
    };
    // фокус ушёл за пределы кнопки и панели (Tab, программный focus) — закрываем
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        {...props.control}
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        aria-disabled={props.inactive || undefined}
        onClick={() => {
          if (!props.inactive) setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          // фокус на кнопке при открытой панели (после Shift+Tab с первого элемента): Esc всё равно закрывает
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
            return;
          }
          if (e.key !== 'Tab' || e.shiftKey || !placed) return;
          const first = focusable()[0];
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
        className={`group ${props.buttonClassName ?? btnSmall} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
      >
        {props.label}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={name}
            data-popover-panel=""
            style={style}
            onKeyDown={(e) => {
              // клавишу уже обработала вложенная панель или кнопка внутри (Tab на краю вложенной панели)
              if (e.defaultPrevented) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
                return;
              }
              if (e.key !== 'Tab') return;
              const items = focusable();
              const edge = e.shiftKey ? items[0] : items[items.length - 1];
              if (items.length > 0 && document.activeElement !== edge) return;
              e.preventDefault();
              if (e.shiftKey) buttonRef.current?.focus();
              else close(true);
            }}
            className={`z-40 overflow-y-auto rounded-2xl bg-card p-3 text-ink shadow-xl ring-1 ring-field ${props.panelClassName ?? 'w-64'}`}
          >
            {props.children(close)}
          </div>,
          // внутри модального окна (<dialog> через showModal) всё вне окна недоступно — панель рисуется в самом окне;
          // вложенная панель — внутри родительской: щелчок и фокус в ней родительскую не закрывают
          rootRef.current?.closest('dialog, [data-popover-panel]') ?? document.body,
        )}
    </div>
  );
}
