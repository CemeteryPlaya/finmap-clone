import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { placeFloating, type FloatingPosition, type FloatingViewport } from '../lib/floating';

/** Видимая область: `visualViewport` (над экранной клавиатурой телефона), иначе окно. */
function visibleArea(): FloatingViewport {
  const v = window.visualViewport;
  return v ? { width: v.width, height: v.height, top: v.offsetTop, left: v.offsetLeft } : { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Стиль всплывающего элемента (панели, подсказки, списка), который рисуется порталом с position: fixed: место
 * считается от якоря до первой отрисовки и пересчитывается при прокрутке (любого контейнера), изменении окна, видимой области (`visualViewport`: экранная клавиатура телефона) и размера
 * самого элемента. Пока места нет — элемент невидим. `matchWidth` — ширина как у якоря (список поля, §6.6 этапа 1.5).
 */
export function useFloating(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  align: 'left' | 'right' = 'left',
  matchWidth = false,
): CSSProperties {
  const [pos, setPos] = useState<(FloatingPosition & { width?: number }) | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (!anchor || !floating) return;
      const rect = anchor.getBoundingClientRect();
      const width = matchWidth ? rect.width : undefined;
      const next = {
        ...placeFloating(rect, { width: width ?? floating.offsetWidth, height: floating.scrollHeight }, visibleArea(), align),
        width,
      };
      setPos((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight && prev.width === next.width ? prev : next,
      );
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    // экранная клавиатура телефона и масштаб меняют только видимую область, не окно
    const visual = window.visualViewport;
    visual?.addEventListener('resize', place);
    visual?.addEventListener('scroll', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (floatingRef.current) observer?.observe(floatingRef.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      visual?.removeEventListener('resize', place);
      visual?.removeEventListener('scroll', place);
      observer?.disconnect();
    };
  }, [open, align, anchorRef, floatingRef, matchWidth]);

  if (!pos) return { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
  return { position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight, ...(pos.width !== undefined ? { width: pos.width } : {}) };
}
