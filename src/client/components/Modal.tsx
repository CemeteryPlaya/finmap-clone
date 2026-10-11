import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { cycleTab, firstTabbable, focusPageHeading, markInitialFocus } from './focus-trap';
import { btnClose } from './ui';

/**
 * Модальное окно на `<dialog>`: открывается через showModal() — браузер держит фокус внутри окна,
 * делает остальную страницу недоступной и закрывает окно по Esc. При закрытии фокус возвращается
 * на элемент, с которого окно открыли. Содержимое монтируется заново при каждом открытии.
 * С `onCancel` окно по Esc и «×» само не закрывается: решает владелец (например, спрашивает про несохранённые изменения).
 *
 * Шапка: заголовок и «×» справа (§2.4 этапа 1.5); на телефоне шапка липкая — «×» видна при прокрутке.
 * Вложенные окна (подтверждение поверх формы) — свои `<dialog>`: их события close и cancel React доставляет
 * и сюда, поэтому окно реагирует только на свои (target === currentTarget).
 * Фокус при закрытии: сначала `returnFocus()` (если вернул элемент на странице), затем кнопка, с которой открыли окно;
 * если и её уже нет — `<h1>` страницы (§11).
 */
export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  children: ReactNode;
  className?: string;
  /** Окно на весь экран телефона (форма операции): отступ под вырез экрана — в липкой шапке, а не у окна. */
  phoneFullScreen?: boolean;
  /**
   * Куда вернуть фокус после закрытия вместо кнопки, с которой открыли окно (после «Указать» — на кнопку строки:
   * плашки уже нет). Вызывается при закрытии; null или элемент не на странице — обычное правило.
   */
  returnFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // useLayoutEffect, а не useEffect: окно открывается и фокус встаёт на место до любого useEffect содержимого.
  // Поле суммы подписывается на focusin в useEffect и кадр спустя забирает «ничей» фокус — оно должно видеть
  // уже итоговое положение, а не промежуточный фокус на «×» (иначе при повторном открытии автофокуса нет)
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // «×» — первая кнопка окна, и showModal() ставит фокус на неё. Начальный фокус — по правилам окна:
      // первый элемент содержимого, а пока содержимое грузится — само окно (поле суммы заберёт его кадр спустя)
      if (document.activeElement === closeRef.current) {
        const first = contentRef.current ? firstTabbable(contentRef.current) : null;
        (first ?? dialog).focus();
        // фокус поставило окно, а не человек: поле с автофокусом (сумма, пустой счёт) его заберёт
        if (first) markInitialFocus(first);
      }
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  const cancel = () => {
    if (props.onCancel) props.onCancel();
    else ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        // Tab по кругу внутри окна: фокус не уходит в адресную строку браузера
        cycleTab(e, ref.current);
        // Esc, который не обработали внутри (список с поиском закрывается сам и отменяет событие)
        if (e.key !== 'Escape' || !props.onCancel || e.defaultPrevented) return;
        // Esc во вложенном окне (подтверждение поверх формы) закрывает только его
        if (e.target instanceof Element && e.target.closest('dialog') !== ref.current) return;
        e.preventDefault();
        props.onCancel();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget || !props.onCancel) return;
        e.preventDefault();
        props.onCancel();
      }}
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        props.onClose();
        const preferred = props.returnFocus?.() ?? null;
        // кнопки, с которой открыли окно, уже нет (строку журнала удалили) или она не принимает фокус — фокус на заголовок страницы
        const back = preferred?.isConnected ? preferred : opener.current;
        if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
        if (!back?.isConnected || back === document.body || document.activeElement !== back) focusPageHeading();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] rounded-3xl bg-card p-0 text-ink shadow-2xl outline-none backdrop:bg-black/40 ${props.className ?? 'max-w-2xl'}`}
    >
      {props.open && (
        <>
          <div
            className={`flex items-start justify-between gap-3 bg-card px-6 pt-6 pb-4 max-md:sticky max-md:top-0 max-md:z-10 ${props.phoneFullScreen ? 'max-md:pt-[calc(1.5rem+env(safe-area-inset-top))]' : ''}`}
          >
            <h2 id={titleId} className="text-xl font-bold">
              {props.title}
            </h2>
            <button ref={closeRef} type="button" data-modal-close="" aria-label="Закрыть" title="Закрыть" onClick={cancel} className={btnClose}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div ref={contentRef} className="px-6 pb-6">
            {props.children}
          </div>
        </>
      )}
    </dialog>
  );
}
