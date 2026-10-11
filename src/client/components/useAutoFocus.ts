import { useEffect, type RefObject } from 'react';
import { isInitialFocus } from './focus-trap';

/**
 * «Ничей» фокус (планы 6a, 1.5-1a, §6.2 этапа 1.5): страница, само окно, «×» окна, радиокнопка или элемент, на который
 * фокус поставило окно при открытии. Такой фокус поле с автофокусом забирает; выбранный человеком — нет.
 */
export function isFreeFocus(el: Element | null): boolean {
  return (
    el === null ||
    el === document.body ||
    el instanceof HTMLDialogElement ||
    (el instanceof HTMLInputElement && el.type === 'radio') ||
    (el instanceof HTMLElement && el.hasAttribute('data-modal-close')) ||
    isInitialFocus(el)
  );
}

/**
 * Поставить фокус в поле при появлении, если он «ничей»: кадр спустя — окно `<dialog>` к этому моменту уже открыто
 * через showModal(). Если человек успел выбрать другое поле (focusin не на «ничьём» элементе) — не трогаем.
 */
export function useAutoFocus(ref: RefObject<HTMLElement | null>, enabled: boolean | undefined): void {
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== ref.current && !isFreeFocus(e.target instanceof Element ? e.target : null)) stop();
    };
    document.addEventListener('focusin', onFocusIn);
    frame = requestAnimationFrame(() => {
      stop();
      if (isFreeFocus(document.activeElement)) ref.current?.focus();
    });
    return stop;
  }, [enabled]);
}
