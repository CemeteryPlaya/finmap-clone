import { z } from 'zod';
import type { BusinessTemplate, CategoryLeaf } from './types';

const ref = (key: string) => `computer-club:${key}`;
const r = (key: string, name: string): CategoryLeaf => ({ ref: ref(key), name });

export const computerClub: BusinessTemplate = {
  key: 'computer-club',
  name: 'Компьютерный клуб',
  params: z.object({
    pcCount: z.number({ message: 'Введите число' }).int('Целое число').min(1, 'Не меньше 1').max(1000, 'Не больше 1000'),
    consoleCount: z.number({ message: 'Введите число' }).int('Целое число').min(0, 'Не меньше 0').max(1000, 'Не больше 1000').default(0),
  }),
  paramsUi: [
    { key: 'pcCount', label: 'Количество ПК', type: 'int' },
    { key: 'consoleCount', label: 'Количество консолей', type: 'int', hint: 'Если консолей нет — 0' },
  ],
  categories: {
    income: [
      r('shift-revenue', 'Выручка за смену (игровое время)'),
      r('bar-sales', 'Бар'),
      r('consoles-vip', 'Консоли и VIP'),
      r('tournaments', 'Турниры'),
      r('other-income', 'Прочие доходы'),
      r('adjustment', 'Корректировка / излишек'),
    ],
    expense: [
      { underSystem: 'salary', children: [r('salary-admins', 'Администраторы'), r('salary-bonuses', 'Премии')] },
      {
        ...r('premises', 'Помещение'),
        children: [r('rent', 'Аренда'), r('utilities', 'Коммунальные услуги'), r('electricity', 'Электроэнергия'), r('internet', 'Интернет')],
      },
      {
        ...r('equipment', 'Оборудование'),
        children: [r('computers', 'Компьютерное оборудование'), r('repair', 'Ремонт и обслуживание'), r('furniture', 'Мебель')],
      },
      r('software', 'ПО и подписки'),
      { ...r('bar', 'Бар'), children: [r('bar-purchase', 'Закуп бара')] },
      {
        ...r('marketing', 'Маркетинг'),
        children: [r('ads', 'Реклама'), r('loyalty', 'Лояльность и бонусы за пополнение'), r('prizes', 'Призовые турниров')],
      },
      {
        ...r('operations', 'Эксплуатация'),
        children: [r('consumables', 'Расходники'), r('hygiene', 'Гигиена и уборка'), r('dry-cleaning', 'Химчистка')],
      },
      { ...r('finance', 'Финансы'), children: [r('bank-fees', 'Комиссии банка и эквайринга'), r('cash-collection', 'Инкассация')] },
      {
        ...r('other', 'Прочее'),
        children: [r('corporate', 'Корпоратив'), r('charity', 'Благотворительность'), r('write-offs', 'Списания')],
      },
    ],
  },
  defaultAccounts: [
    { name: 'Касса {project}', currency: 'KZT' },
    { name: 'Kaspi {project}', currency: 'KZT' },
  ],
  integrations: ['senet'],
  metrics: [
    { key: 'revenuePerPcPerDay', label: 'Выручка на ПК в день', unit: 'money' },
    { key: 'barShare', label: 'Доля бара в выручке', unit: 'percent' },
    { key: 'payrollToRevenue', label: 'ФОТ к выручке', unit: 'percent' },
    { key: 'rentToRevenue', label: 'Аренда к выручке', unit: 'percent' },
  ],
  // «Закуп бара» — в себестоимости для закупок без документа склада (§8.2)
  indicatorDefaults: {
    cogs: [ref('bar-purchase')],
    variable: [ref('bar-purchase'), ref('loyalty'), ref('bank-fees'), ref('prizes'), ref('consumables')],
  },
};
