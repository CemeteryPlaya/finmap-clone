import { queryClient } from './query';
import { savePreference, usePreferences } from './queries';

/** Свёрнутая левая панель (§3.6 этапа 1.5): одна настройка для панели счетов и меню настроек. */
export const SIDEBAR_PREF = 'sidebar.collapsed';

/**
 * Состояние левой панели. Выбор виден сразу и в другой панели (кэш настроек меняется до ответа сервера);
 * сохраняется в фоне, сбой сохранения не мешает работе.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const prefs = usePreferences();
  const collapsed = prefs.data?.[SIDEBAR_PREF] === true;
  const toggle = () => {
    const next = !collapsed;
    queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [SIDEBAR_PREF]: next }));
    savePreference(SIDEBAR_PREF, next).catch(() => undefined);
  };
  return { collapsed, toggle };
}
