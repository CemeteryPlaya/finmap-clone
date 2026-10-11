import { describe, expect, it } from 'vitest';
import { createItemLabel, initialActive, pickerItems, type PickerOption } from '../../src/client/lib/picker';

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
    expect(createItemLabel('Аренда', 'категорию')).toBe('+ Создать „Аренда“');
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
