import { describe, expect, it } from 'vitest';
import { createItemLabel, initialActive, pickerItems, pickQuery, typedQuery, type PickerOption } from '../../src/client/lib/picker';

const options: PickerOption[] = [
  { id: 0, label: 'Без категории' },
  { id: 1, label: 'Аренда' },
  { id: 2, label: 'Ёлки' },
  { id: 3, label: 'Аренда склада' },
];
const labels = (items: ReturnType<typeof pickerItems>) => items.map((it) => (it.kind === 'option' ? it.option.label : `create:${it.name}`));

describe('pickerItems — пункты списка с поиском (§6.6 этапа 1.5)', () => {
  it('без «+ Создать»: варианты, подходящие под запрос без учёта регистра и «ё»; пустой запрос — все', () => {
    expect(labels(pickerItems(options, ''))).toEqual(['Без категории', 'Аренда', 'Ёлки', 'Аренда склада']);
    expect(labels(pickerItems(options, '  АРЕН '))).toEqual(['Аренда', 'Аренда склада']);
    expect(labels(pickerItems(options, 'елки'))).toEqual(['Ёлки']);
    expect(pickerItems(options, 'нет такого')).toEqual([]);
  });

  it('с «+ Создать»: пустой запрос — пункт первым; с текстом — после найденных, если такого названия ещё нет', () => {
    expect(labels(pickerItems(options, '', 'категорию'))).toEqual(['create:', 'Без категории', 'Аренда', 'Ёлки', 'Аренда склада']);
    expect(labels(pickerItems(options, 'арен', 'категорию'))).toEqual(['Аренда', 'Аренда склада', 'create:арен']);
    expect(labels(pickerItems(options, '  Интернет ', 'категорию'))).toEqual(['create:Интернет']);
    // такое название уже есть (без учёта регистра и «ё») — создавать нечего
    expect(labels(pickerItems(options, 'аренда', 'категорию'))).toEqual(['Аренда', 'Аренда склада']);
    expect(labels(pickerItems(options, 'ЕЛКИ', 'категорию'))).toEqual(['Ёлки']);
  });

  it('подпись пункта «+ Создать»', () => {
    expect(createItemLabel('', 'категорию')).toBe('+ Создать категорию');
    expect(createItemLabel('Аренда', 'категорию')).toBe('+ Создать категорию „Аренда“');
  });
});

describe('initialActive — активный пункт при открытии и после нового запроса', () => {
  it('выбранный; без выбранного — первый вариант, а не «+ Создать»; только «+ Создать» — он', () => {
    expect(initialActive(pickerItems(options, '', 'категорию'), 3)).toBe(4);
    expect(initialActive(pickerItems(options, '', 'категорию'), null)).toBe(1);
    expect(initialActive(pickerItems(options, '', 'категорию'), 99)).toBe(1);
    // Enter после печати выбирает найденное, а не создаёт (Review Focus 2)
    expect(initialActive(pickerItems(options, 'арен', 'категорию'), undefined)).toBe(0);
    expect(initialActive(pickerItems(options, 'Интернет', 'категорию'), undefined)).toBe(0);
    expect(initialActive([], null)).toBe(0);
  });
});

describe('typedQuery — запрос из разницы между показанным названием и новым значением поля', () => {
  it('печать в конец: напечатанное', () => {
    expect(typedQuery('Аренда', 'Арендаб')).toBe('б');
    expect(typedQuery('Аренда', 'Аренда склад')).toBe(' склад');
  });
  it('перекомпоновка IME (Gboard): «Аренда» → «Арендаи» даёт «и»', () => {
    expect(typedQuery('Аренда', 'Арендаи')).toBe('и');
  });
  it('Backspace и вырезание: «Аренда» → «Арен» даёт пустой запрос', () => {
    expect(typedQuery('Аренда', 'Арен')).toBe('');
    expect(typedQuery('Аренда', '')).toBe('');
  });
  it('вставка в середину: «Аренда» → «Арезанда» даёт «за»', () => {
    expect(typedQuery('Аренда', 'Арезанда')).toBe('за');
  });
  it('замена выделенного: «Аренда» → «Х» даёт «Х»; без изменений — пусто', () => {
    expect(typedQuery('Аренда', 'Х')).toBe('Х');
    expect(typedQuery('Аренда', 'Аренда')).toBe('');
  });
  it('пустое показанное название: запрос — всё значение', () => {
    expect(typedQuery('', 'бар')).toBe('бар');
  });
  it('повторяющиеся символы не дают наложения префикса и суффикса: «аа» → «ааа» даёт «а»', () => {
    expect(typedQuery('аа', 'ааа')).toBe('а');
  });
});

describe('pickQuery — запрос закрытого поля по событию ввода', () => {
  const base = { shown: 'Аренда', selectedAll: false, data: null as string | null, inputType: 'insertText' };
  it('всё название выделено (Tab в поле) и напечатан символ: «А» и «а» — запрос, а не пустота', () => {
    expect(pickQuery({ ...base, next: 'А', data: 'А', selectedAll: true })).toBe('А');
    expect(pickQuery({ ...base, next: 'а', data: 'а', selectedAll: true })).toBe('а');
  });
  it('вставка поверх выделенного названия: «интернет» поверх «Интернет» — всё вставленное', () => {
    expect(pickQuery({ shown: 'Интернет', next: 'интернет', data: 'интернет', inputType: 'insertFromPaste', selectedAll: true })).toBe('интернет');
    expect(pickQuery({ shown: 'Интернет', next: 'интернет', data: null, inputType: 'insertFromPaste', selectedAll: true })).toBe('интернет');
  });
  it('перекомпоновка клавиатуры телефона без data — разница с названием', () => {
    expect(pickQuery({ ...base, next: 'Арендаи', inputType: 'insertCompositionText' })).toBe('и');
    expect(pickQuery({ ...base, next: 'Арендаи', data: 'Арендаи', inputType: 'insertCompositionText' })).toBe('и');
  });
  it('Backspace и вырезание — пустой запрос', () => {
    expect(pickQuery({ ...base, next: 'Арен', inputType: 'deleteContentBackward' })).toBe('');
    expect(pickQuery({ ...base, next: '', inputType: 'deleteByCut', selectedAll: true })).toBe('');
  });
  it('печать в конец без выделения — напечатанный символ', () => {
    expect(pickQuery({ ...base, next: 'Арендаа', data: 'а' })).toBe('а');
  });
  it('без inputType и data — разница', () => {
    expect(pickQuery({ shown: 'Аренда', next: 'Арендаи', data: null, inputType: '', selectedAll: false })).toBe('и');
  });
});
