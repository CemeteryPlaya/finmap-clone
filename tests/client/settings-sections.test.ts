import { describe, expect, it } from 'vitest';
import { ACCOUNT_GROUP_LABEL, DEFAULT_SETTINGS_SECTION, settingsGroups, SHARED_NOTE } from '../../src/client/lib/settings-sections';

describe('навигация зоны настроек (§4.2 этапа 1.5)', () => {
  it('группы и порядок как в Finmap; вторая группа подписана названием компании', () => {
    const groups = settingsGroups('ТОО «Демо Клубы»');
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.path)])).toEqual([
      ['account', null, ['profile', 'companies']],
      ['company', 'ТОО «Демо Клубы»', ['counterparties', 'accounts', 'categories', 'projects', 'tags', 'warehouses', 'users', 'rates', 'backup']],
      ['view', 'Визуальные настройки', ['journal']],
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'Профиль',
      'Мои компании',
      'Контрагенты',
      'Счета',
      'Категории',
      'Проекты',
      'Теги',
      'Склады',
      'Пользователи',
      'Фиксированные курсы валют',
      'Резервное копирование',
      'Настройки журнала',
    ]);
  });

  it('«История действий» и «Шаблоны разделения» — не пункты навигации; раздел по умолчанию — контрагенты', () => {
    const paths = settingsGroups('X').flatMap((g) => g.items.map((i) => i.path));
    expect(paths).not.toContain('audit');
    expect(paths).not.toContain('split-presets');
    expect(DEFAULT_SETTINGS_SECTION).toBe('counterparties');
    expect(SHARED_NOTE).toBe('Общие для всех компаний');
  });

  it('группа аккаунта без подзаголовка называется «Мой аккаунт» — как в панели «Настройки» (итоги 1.5-1b №1)', () => {
    expect(ACCOUNT_GROUP_LABEL).toBe('Мой аккаунт');
  });
});
