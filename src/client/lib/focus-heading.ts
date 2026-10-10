import { focusPageHeading } from '../components/focus-trap';

/** Сколько мс после смены адреса ждать, прежде чем принять прежний `<h1>` (React переиспользовал страницу). */
export const SAME_PAGE_MS = 100;
/** Адрес не сменился за столько мс — переход на текущую страницу: годится и прежний `<h1>`. */
export const NO_NAVIGATION_MS = 160;
/** Не дольше 2 с: страница может сначала показывать «Загрузка…» без заголовка. */
export const GIVE_UP_MS = 2000;

/**
 * Годится ли найденный `main h1`. isPrevious — это тот же элемент, что был на странице в момент нажатия;
 * elapsed — мс с нажатия; changedAt — момент (мс с нажатия), когда адрес впервые отличался от исходного, или null.
 */
export function acceptHeading(s: { isPrevious: boolean; elapsed: number; changedAt: number | null }): boolean {
  if (!s.isPrevious) return true;
  if (s.changedAt !== null) return s.elapsed - s.changedAt >= SAME_PAGE_MS;
  return s.elapsed >= NO_NAVIGATION_MS;
}

/**
 * Фокус на заголовок `<h1>` новой страницы после перехода по ссылке из выезжающей панели (§11 этапа 1.5).
 * Вызывать в обработчике нажатия ссылки, ДО перехода: запоминаются адрес и `main h1` на момент нажатия.
 * React Router рисует новую страницу в startTransition — старый заголовок ещё некоторое время на месте,
 * и фокус на нём ушёл бы в body, когда старая страница размонтируется. Поэтому прежний заголовок берётся,
 * только когда это та же страница (acceptHeading). Пока фокус на прежнем заголовке, проверка `isConnected`
 * идёт до конца ожидания: если он исчез, поиск начинается заново. У новой страницы заголовка может не быть
 * (экран «Загрузка…») — ждём до GIVE_UP_MS и в body не уходим. Заголовку без `tabindex` ставится `tabindex="-1"`.
 */
export function focusHeadingSoon(): void {
  const where = () => window.location.pathname + window.location.search;
  const startedAt = where();
  const previous = document.querySelector<HTMLElement>('main h1');
  const t0 = performance.now();
  let changedAt: number | null = null;
  let focused: HTMLElement | null = null;
  let held = 0;
  const tick = () => {
    const elapsed = performance.now() - t0;
    if (changedAt === null && where() !== startedAt) changedAt = elapsed;
    if (focused) {
      if (!focused.isConnected) {
        // старая страница размонтировалась вместе с заголовком — ищем новый
        focused = null;
        held = 0;
      } else if (document.activeElement !== focused) {
        return; // пользователь уже сам увёл фокус
      } else if (focused !== previous && ++held >= 2) {
        return; // новый заголовок на месте и в фокусе — готово
      }
    }
    if (!focused) {
      const heading = document.querySelector<HTMLElement>('main h1');
      if (heading && acceptHeading({ isPrevious: heading === previous, elapsed, changedAt })) {
        focusPageHeading();
        // фокус не встал (панель ещё закрывается и страница под ней недоступна) — попробуем в следующем кадре
        if (document.activeElement === heading) focused = heading;
      }
    }
    if (elapsed < GIVE_UP_MS) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
