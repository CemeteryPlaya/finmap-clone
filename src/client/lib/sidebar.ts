import { api } from './api';
import { queryClient } from './query';
import { usePreferences } from './queries';

/** Свёрнутая левая панель (§3.6 этапа 1.5): одна настройка для панели счетов и меню настроек. */
export const SIDEBAR_PREF = 'sidebar.collapsed';

/** Номер последней записи: поздний ответ на прежнюю запись кэш не меняет (быстрые двойные нажатия). */
let latestWrite = 0;

const setCached = (value: boolean | undefined) =>
  queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => {
    const next = { ...(old ?? {}) };
    if (value === undefined) delete next[SIDEBAR_PREF];
    else next[SIDEBAR_PREF] = value;
    return next;
  });

/**
 * Состояние левой панели. Выбор виден сразу и в другой панели (кэш настроек меняется до ответа сервера);
 * сохраняется в фоне. Сбой сохранения возвращает прежнее значение; кэш меняет только ответ на последнюю запись.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const prefs = usePreferences();
  const collapsed = prefs.data?.[SIDEBAR_PREF] === true;
  const toggle = () => {
    const next = !collapsed;
    const previous = queryClient.getQueryData<Record<string, unknown>>(['preferences'])?.[SIDEBAR_PREF] as boolean | undefined;
    const mine = ++latestWrite;
    setCached(next);
    api(`/preferences/${encodeURIComponent(SIDEBAR_PREF)}`, { method: 'PUT', body: { value: next } }).catch(() => {
      if (mine === latestWrite) setCached(previous);
    });
  };
  return { collapsed, toggle };
}
