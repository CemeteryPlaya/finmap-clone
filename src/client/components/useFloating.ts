import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { placeFloating, type FloatingPosition } from '../lib/floating';

/**
 * Стиль всплывающего элемента (панели, подсказки), который рисуется порталом в body с position: fixed:
 * место считается от кнопки до первой отрисовки и пересчитывается при прокрутке (любого контейнера),
 * изменении окна и размера самого элемента. Пока места нет — элемент невидим.
 */
export function useFloating(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  align: 'left' | 'right' = 'left',
): CSSProperties {
  const [pos, setPos] = useState<FloatingPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      const next = placeFloating(
        anchor.getBoundingClientRect(),
        { width: floating.offsetWidth, height: floating.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight ? prev : next));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (floatingRef.current) observer?.observe(floatingRef.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [open, align, anchorRef, floatingRef]);

  return pos ? { position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
}
