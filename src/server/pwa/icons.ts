import { BRAND_COLORS } from '../../shared/brand';
import { encodePng } from './png';

/**
 * Вид иконки: `any` — скруглённый квадрат на прозрачном фоне (вкладка, ярлык на компьютере);
 * `full` — фон на всю площадь без скруглений (`maskable` в манифесте и `apple-touch-icon`: система сама
 * обрезает углы, а прозрачные углы iOS закрасила бы чёрным).
 */
export type IconVariant = 'any' | 'full';

/** Скруглённый прямоугольник в долях стороны иконки (0…1). */
export interface IconShape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  color: string;
}

/**
 * Рисунок иконки: графитовый фон и три растущих столбика. Столбики — внутри круга радиусом 0,4 стороны
 * («безопасная зона» maskable-иконки), поэтому их не срежет ни одна маска.
 */
export function iconShapes(variant: IconVariant): IconShape[] {
  const background: IconShape = { x: 0, y: 0, w: 1, h: 1, r: variant === 'any' ? 0.22 : 0, color: BRAND_COLORS.chrome };
  const bars = [0.24, 0.38, 0.52].map((h, i) => ({
    x: 0.25 + i * 0.19,
    y: 0.76 - h,
    w: 0.12,
    h,
    r: 0.03,
    color: i === 2 ? BRAND_COLORS.incomeSoft : BRAND_COLORS.income,
  }));
  return [background, ...bars];
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function inside(s: IconShape, x: number, y: number): boolean {
  if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
  const dx = Math.max(s.x + s.r - x, 0, x - (s.x + s.w - s.r));
  const dy = Math.max(s.y + s.r - y, 0, y - (s.y + s.h - s.r));
  return dx * dx + dy * dy <= s.r * s.r;
}

/** Точек на пиксель по каждой оси: края фигур сглажены. */
const SUPERSAMPLE = 4;

/** Пиксели RGBA иконки size×size: в каждой точке — цвет верхней фигуры, края сглажены усреднением. */
export function renderIcon(size: number, variant: IconVariant): Uint8Array {
  const shapes = iconShapes(variant).map((shape) => ({ shape, color: rgb(shape.color) }));
  const out = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i]!;
            if (!inside(s.shape, x, y)) continue;
            r += s.color[0];
            g += s.color[1];
            b += s.color[2];
            hits++;
            break;
          }
        }
      }
      if (hits === 0) continue;
      const k = (py * size + px) * 4;
      // цвет — среднее по закрашенным точкам, прозрачность — доля закрашенных: без тёмной каймы на краю
      out[k] = Math.round(r / hits);
      out[k + 1] = Math.round(g / hits);
      out[k + 2] = Math.round(b / hits);
      out[k + 3] = Math.round((255 * hits) / samples);
    }
  }
  return out;
}

const pngCache = new Map<string, Buffer>();

/** PNG иконки; рисуется при первом запросе и остаётся в памяти. */
export function iconPng(size: number, variant: IconVariant): Buffer {
  const key = `${size}:${variant}`;
  let png = pngCache.get(key);
  if (!png) {
    png = encodePng(size, size, renderIcon(size, variant));
    pngCache.set(key, png);
  }
  return png;
}

/** Та же иконка в SVG (значок вкладки): координаты — в долях стороны 512. */
export function iconSvg(): string {
  const n = (v: number) => String(Math.round(v * 512 * 100) / 100);
  const rects = iconShapes('any')
    .map((s) => `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(s.r)}" fill="${s.color}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${rects}</svg>`;
}
