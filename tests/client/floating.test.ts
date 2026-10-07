import { describe, expect, it } from 'vitest';
import { placeFloating } from '../../src/client/lib/floating';

const viewport = { width: 1280, height: 720 };
const anchor = (top: number, left: number, width = 80, height = 30) => ({ top, bottom: top + height, left, right: left + width });

describe('placeFloating — место всплывающей панели в окне', () => {
  it('под кнопкой, если снизу хватает места; высота — не больше свободного места', () => {
    expect(placeFloating(anchor(100, 200), { width: 288, height: 250 }, viewport)).toEqual({ top: 138, left: 200, maxHeight: 574 });
  });

  it('над кнопкой, если снизу не хватает, а сверху места больше', () => {
    // кнопка у нижнего края: снизу 720 - 690 - 16 = 14 px, сверху 660 - 16 = 644 px
    expect(placeFloating(anchor(660, 200), { width: 288, height: 250 }, viewport)).toEqual({ top: 402, left: 200, maxHeight: 644 });
  });

  it('длинная панель — там, где места больше, высотой со свободное место (прокручивается внутри)', () => {
    expect(placeFloating(anchor(300, 200), { width: 288, height: 900 }, viewport)).toEqual({ top: 338, left: 200, maxHeight: 374 });
    expect(placeFloating(anchor(400, 200), { width: 288, height: 900 }, viewport)).toEqual({ top: 8, left: 200, maxHeight: 384 });
  });

  it('по правому краю кнопки и в пределах окна по горизонтали', () => {
    expect(placeFloating(anchor(100, 1000), { width: 288, height: 100 }, viewport, 'right').left).toBe(792);
    expect(placeFloating(anchor(100, 1200), { width: 288, height: 100 }, viewport).left).toBe(984);
    expect(placeFloating(anchor(100, 0, 40), { width: 288, height: 100 }, viewport, 'right').left).toBe(8);
  });
});
