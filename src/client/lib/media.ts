import { useSyncExternalStore } from 'react';

/**
 * Телефон (§7 «Мобильная версия»): ширина меньше 768 px — та же граница, что у вариантов Tailwind
 * `md:` и `max-md:` (48rem).
 */
export const MOBILE_QUERY = '(width < 48rem)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Узкий экран сейчас: перерисовывает компонент при повороте телефона и изменении окна. Нужен там, где
 * на телефоне показывается другой компонент (карточки вместо таблицы); оформление — классами `max-md:`.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
