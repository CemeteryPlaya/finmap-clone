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

  it('экранная клавиатура телефона: видимая область ниже окна обрезана — список укорачивается или идёт вверх', () => {
    // 390x844, клавиатура занимает низ: видимая высота 500; поле «Категория» на y 340..396
    const phone = { width: 390, height: 500, top: 0, left: 0 };
    const field = anchor(340, 16, 358, 56);
    // снизу 500 - 396 - 16 = 88 px, сверху 340 - 16 = 324 px: длинный список идёт над полем и целиком в видимой области
    const up = placeFloating(field, { width: 358, height: 900 }, phone);
    expect(up).toEqual({ top: 8, left: 16, maxHeight: 324 });
    // без поправки на клавиатуру (высота окна 844) список открылся бы вниз и ушёл под клавиатуру
    expect(placeFloating(field, { width: 358, height: 900 }, { width: 390, height: 844 }).top).toBe(404);
    // короткий список помещается под полем в видимой области
    expect(placeFloating(anchor(100, 16, 358, 56), { width: 358, height: 900 }, phone)).toEqual({ top: 164, left: 16, maxHeight: 328 });
  });

  it('смещение видимой области (offsetTop, offsetLeft) учитывается: список не выходит за её верх и край', () => {
    const shifted = { width: 390, height: 400, top: 200, left: 0 };
    // поле на y 260..316: сверху 260 - 200 - 16 = 44 px, снизу 600 - 316 - 16 = 268 px — вниз
    expect(placeFloating(anchor(260, 16, 358, 56), { width: 358, height: 900 }, shifted)).toEqual({ top: 324, left: 16, maxHeight: 268 });
    // поле у низа видимой области: вверх, но не выше её верха + отступ
    expect(placeFloating(anchor(520, 16, 358, 56), { width: 358, height: 900 }, shifted).top).toBe(208);
    expect(placeFloating(anchor(100, 0, 40), { width: 288, height: 100 }, { width: 300, height: 400, top: 0, left: 50 }).left).toBe(58);
  });

  it('по правому краю кнопки и в пределах окна по горизонтали', () => {
    expect(placeFloating(anchor(100, 1000), { width: 288, height: 100 }, viewport, 'right').left).toBe(792);
    expect(placeFloating(anchor(100, 1200), { width: 288, height: 100 }, viewport).left).toBe(984);
    expect(placeFloating(anchor(100, 0, 40), { width: 288, height: 100 }, viewport, 'right').left).toBe(8);
  });
});
