import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { btnSmall } from './ui';
import { useFloating } from './useFloating';

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"], a[href]';

/**
 * Всплывающая панель у кнопки: кнопка с aria-haspopup и aria-expanded, панель — немодальный role="dialog".
 * Панель рисуется порталом в body (position: fixed), поэтому её не обрезают контейнеры с прокруткой
 * (обёртка таблицы журнала). При открытии фокус — на первом элементе панели; Esc закрывает и возвращает
 * фокус на кнопку; клик мимо и уход фокуса из кнопки и панели закрывают её.
 * Панель в DOM стоит вне кнопки, поэтому порядок Tab замкнут вручную: Tab с кнопки ведёт в панель,
 * Shift+Tab с первого элемента панели — на кнопку, Tab за последним элементом закрывает панель
 * и возвращает фокус на кнопку.
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
  const name = props.ariaLabel ?? (typeof props.label === 'string' ? props.label : undefined);

  /** Узел — внутри кнопки или панели (панель не внутри rootRef: она в портале). */
  const inside = (node: Node | null) => !!node && (!!rootRef.current?.contains(node) || !!panelRef.current?.contains(node));
  const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (placed) focusable()[0]?.focus();
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
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
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
        className={props.buttonClassName ?? btnSmall}
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
            style={style}
            onKeyDown={(e) => {
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
          document.body,
        )}
    </div>
  );
}
