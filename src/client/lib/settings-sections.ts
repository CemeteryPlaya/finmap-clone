/** Раздел зоны настроек: адрес `settings/<path>` и подпись в навигации (§4.2 этапа 1.5). */
export interface SettingsSection {
  path: string;
  label: string;
}

export interface SettingsGroup {
  key: 'account' | 'company' | 'view';
  /** Подзаголовок группы; у группы аккаунта его нет. */
  title: string | null;
  items: readonly SettingsSection[];
}

/** Раздел, куда ведут «Настройки» без раздела и неизвестные адреса (§4.2). */
export const DEFAULT_SETTINGS_SECTION = 'counterparties';

/** Серая строка на страницах разделов, общих для экземпляра: пользователи, резервное копирование, ручные курсы (§4.2). */
export const SHARED_NOTE = 'Общие для всех компаний';

/** Имя группы аккаунта (Профиль, Мои компании): видимого подзаголовка у неё нет, а группе нужно имя (итоги 1.5-1b №1). */
export const ACCOUNT_GROUP_LABEL = 'Мой аккаунт';

/**
 * Навигация зоны настроек в порядке Finmap (03-№3); вторая группа подписана названием компании.
 * «История действий» сюда не входит — к ней ведёт «Подробнее» из панели истории (§3.4).
 */
export function settingsGroups(companyName: string): SettingsGroup[] {
  return [
    {
      key: 'account',
      title: null,
      items: [
        { path: 'profile', label: 'Профиль' },
        { path: 'companies', label: 'Мои компании' },
      ],
    },
    {
      key: 'company',
      title: companyName,
      items: [
        { path: 'counterparties', label: 'Контрагенты' },
        { path: 'accounts', label: 'Счета' },
        { path: 'categories', label: 'Категории' },
        { path: 'projects', label: 'Проекты' },
        { path: 'tags', label: 'Теги' },
        { path: 'warehouses', label: 'Склады' },
        { path: 'users', label: 'Пользователи' },
        { path: 'rates', label: 'Фиксированные курсы валют' },
        { path: 'backup', label: 'Резервное копирование' },
      ],
    },
    {
      key: 'view',
      title: 'Визуальные настройки',
      items: [{ path: 'journal', label: 'Настройки журнала' }],
    },
  ];
}
