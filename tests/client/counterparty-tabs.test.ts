import { describe, expect, it } from 'vitest';
import { COUNTERPARTY_TABS, counterpartyTab, counterpartyTabInfo, tabOfType } from '../../src/client/lib/counterparty-tabs';

describe('вкладки контрагентов (§7.3 этапа 1.5)', () => {
  it('порядок и подписи как в Finmap; «Мои контрагенты» — последней', () => {
    expect(COUNTERPARTY_TABS.map((t) => t.label)).toEqual([
      'Инвесторы',
      'Кредиторы',
      'Заёмщики',
      'Сотрудники',
      'Владельцы',
      'Типы налогов',
      'Мои контрагенты',
    ]);
    expect(COUNTERPARTY_TABS.map((t) => t.add)).toEqual([
      'Добавить инвестора',
      'Добавить кредитора',
      'Добавить заёмщика',
      'Добавить сотрудника',
      'Добавить владельца',
      'Добавить тип налога',
      'Добавить контрагента',
    ]);
  });

  it('заголовки окон', () => {
    expect(counterpartyTabInfo('tax')).toMatchObject({ createTitle: 'Новый тип налога', editTitle: 'Тип налога' });
    expect(counterpartyTabInfo('my')).toMatchObject({ createTitle: 'Новый контрагент', editTitle: 'Контрагент' });
  });

  it('параметр адреса: известный тип — он, иначе «Мои контрагенты»', () => {
    expect(counterpartyTab('employee')).toBe('employee');
    expect(counterpartyTab('my')).toBe('my');
    expect(counterpartyTab(null)).toBe('my');
    expect(counterpartyTab('nope')).toBe('my');
    expect(counterpartyTab('client')).toBe('my');
  });

  it('клиенты и поставщики — во вкладке «Мои контрагенты», остальные — в своей', () => {
    expect(tabOfType('client')).toBe('my');
    expect(tabOfType('supplier')).toBe('my');
    expect(tabOfType('owner')).toBe('owner');
    expect(tabOfType('tax')).toBe('tax');
  });
});
