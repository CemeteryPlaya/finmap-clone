export const inputClass = 'w-full rounded-xl bg-field px-4 py-3 outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';
/**
 * Поле с плавающей подписью (§6.3 этапа 1.5): высота 56 px, место под мелкую подпись сверху. Подпись рисует `Field floating`.
 * `floatingControlBase` — без размера шрифта (у суммы он свой, `text-lg`): два размера в одном классе Tailwind не перекрывают друг друга надёжно.
 */
export const floatingControlBase = 'block h-14 w-full rounded-xl bg-field px-4 pt-5 pb-1 outline-none placeholder:text-label focus:ring-2 focus:ring-focus disabled:opacity-60';
export const floatingControlClass = `${floatingControlBase} text-base`;
/** Многострочное поле с плавающей подписью (комментарий). */
export const floatingTextareaClass = 'block w-full rounded-xl bg-field px-4 pt-6 pb-2 text-base outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';
/** Бейдж «системная» (§5.2, §6.6 этапа 1.5): текст income-strong на income-soft — 4,7:1. */
export const badgeClass = 'shrink-0 rounded bg-income-soft px-1.5 py-0.5 text-[11px] font-medium text-income-strong';
export const btnPrimary = 'rounded-xl bg-income px-4 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-50';
export const btnSecondary = 'rounded-xl bg-field px-4 py-2.5 font-medium text-ink hover:brightness-95 disabled:opacity-50';
export const btnDanger = 'rounded-xl bg-expense-soft px-4 py-2.5 font-medium text-expense hover:brightness-95 disabled:opacity-50';
export const btnSmall = 'rounded-lg bg-field px-3 py-1.5 text-sm font-medium text-ink hover:brightness-95 disabled:opacity-50';
export const btnIcon = 'rounded-lg bg-field px-2.5 py-1.5 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-30';
/** «×» в шапке окна: на телефоне цель касания не меньше 44×44 px, знак по центру; на компьютере размер как у btnIcon. */
export const btnClose = `${btnIcon} shrink-0 max-md:flex max-md:size-11 max-md:items-center max-md:justify-center max-md:p-0`;
/** Круглая кнопка-иконка в тёмной шапке (история действий, настройки) с видимой рамкой фокуса. */
export const headerIconClass =
  'grid h-10 w-10 shrink-0 place-items-center rounded-full max-md:size-11 bg-chrome-2 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
export const alertClass = 'mb-4 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense';
export const noticeClass = 'mb-4 rounded-xl bg-field px-4 py-3 text-sm text-muted';

/**
 * Белая карточка содержимого страницы компании (журнал, раздел настроек). На телефоне снизу — место под панель
 * «Доход», «Расход», «Перевод»; длинные слова без пробелов переносятся, выпадающие списки не шире своего блока.
 */
export const mainCardClass =
  'min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] max-md:[overflow-wrap:anywhere] max-md:[&_select]:max-w-full md:p-8';
