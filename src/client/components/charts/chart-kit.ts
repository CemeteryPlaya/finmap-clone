import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { SliceColor } from '../../lib/charts';

/**
 * Цвета графиков — только токены темы (`--color-chart-*` в styles.css): тёмная тема переопределит токены, а не компоненты. Классы перечислены целиком — Tailwind находит их
 * в исходнике.
 */
const FILL = ['fill-chart-1', 'fill-chart-2', 'fill-chart-3', 'fill-chart-4', 'fill-chart-5', 'fill-chart-6', 'fill-chart-7', 'fill-chart-8'] as const;
const BG = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5', 'bg-chart-6', 'bg-chart-7', 'bg-chart-8'] as const;

export const fillOf = (c: SliceColor): string => (c === 'other' ? 'fill-chart-other' : FILL[c % FILL.length]!);
export const bgOf = (c: SliceColor): string => (c === 'other' ? 'bg-chart-other' : BG[c % BG.length]!);

/** Ширина блока в пикселях: графики считают координаты по настоящей ширине, текст не растягивается. 0 — ещё не измерено. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Отступы области построения: слева — подписи оси, снизу — подписи колонок. */
export const PLOT = { height: 240, left: 64, right: 8, top: 12, bottom: 28 } as const;
