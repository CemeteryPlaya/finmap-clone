export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FloatingPosition {
  top: number;
  left: number;
  /** Не выше свободного места: длинная панель прокручивается внутри себя. */
  maxHeight: number;
}

/** Отступ от кнопки и от краёв окна, px. */
export const FLOATING_GAP = 8;
const MIN_HEIGHT = 120;

/**
 * Место всплывающей панели у кнопки в координатах окна (position: fixed): под кнопкой, а если снизу не хватает
 * места и сверху его больше — над ней; по горизонтали — от левого или правого края кнопки, в пределах окна.
 * Панель живёт вне контейнеров с прокруткой, поэтому её не обрезает, например, обёртка таблицы.
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right' = 'left',
): FloatingPosition {
  const below = viewport.height - anchor.bottom - FLOATING_GAP * 2;
  const above = anchor.top - FLOATING_GAP * 2;
  const up = size.height > below && above > below;
  const maxHeight = Math.max(MIN_HEIGHT, up ? above : below);
  const height = Math.min(size.height, maxHeight);
  const top = up ? Math.max(FLOATING_GAP, anchor.top - FLOATING_GAP - height) : anchor.bottom + FLOATING_GAP;
  const wanted = align === 'right' ? anchor.right - size.width : anchor.left;
  const left = Math.max(FLOATING_GAP, Math.min(wanted, viewport.width - size.width - FLOATING_GAP));
  return { top, left, maxHeight };
}
