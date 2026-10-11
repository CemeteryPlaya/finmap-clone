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

/**
 * Видимая область в координатах окна (как getBoundingClientRect): без `top` и `left` это всё окно; при экранной
 * клавиатуре телефона и масштабировании — `window.visualViewport` (высота без клавиатуры, смещение `offsetTop`).
 */
export interface FloatingViewport {
  width: number;
  height: number;
  top?: number;
  left?: number;
}

const MIN_HEIGHT = 120;

/**
 * Место всплывающей панели у кнопки в координатах окна (position: fixed): под кнопкой, а если снизу не хватает
 * места и сверху его больше — над ней; по горизонтали — от левого или правого края кнопки, в пределах окна.
 * Панель живёт вне контейнеров с прокруткой, поэтому её не обрезает, например, обёртка таблицы. Место считается
 * в видимой области (`viewport`): над экранной клавиатурой телефона список ставится выше неё или укорачивается.
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: FloatingViewport,
  align: 'left' | 'right' = 'left',
): FloatingPosition {
  const vTop = viewport.top ?? 0;
  const vLeft = viewport.left ?? 0;
  const below = vTop + viewport.height - anchor.bottom - FLOATING_GAP * 2;
  const above = anchor.top - vTop - FLOATING_GAP * 2;
  const up = size.height > below && above > below;
  const maxHeight = Math.max(MIN_HEIGHT, up ? above : below);
  const height = Math.min(size.height, maxHeight);
  const top = up ? Math.max(vTop + FLOATING_GAP, anchor.top - FLOATING_GAP - height) : anchor.bottom + FLOATING_GAP;
  const wanted = align === 'right' ? anchor.right - size.width : anchor.left;
  const left = Math.max(vLeft + FLOATING_GAP, Math.min(wanted, vLeft + viewport.width - size.width - FLOATING_GAP));
  return { top, left, maxHeight };
}
