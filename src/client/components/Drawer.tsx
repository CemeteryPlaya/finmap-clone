import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cycleTab, focusPageHeading } from './focus-trap';
import { btnClose } from './ui';

/**
 * Выезжающая панель (§7 «Мобильная версия»): модальное окно `<dialog>` у левого или правого края экрана.
 * showModal() делает остальную страницу недоступной, Tab и Shift+Tab ходят по кругу внутри панели (не уходят
 * в адресную строку браузера); Esc, «Закрыть»
 * и касание затемнённого фона закрывают панель, фокус возвращается на кнопку, которой её открыли.
 * Отступы учитывают вырезы экрана (safe-area). Содержимое монтируется заново при каждом открытии.
 */
export function Drawer(props: {
  open: boolean;
  title: string;
  /** Строка под заголовком (логин под именем пользователя). */
  subtitle?: ReactNode;
  side: 'left' | 'right';
  onClose: () => void;
  /**
   * После закрытия панели — только сигнал: true — был переход по ссылке (фокус ставит focusHeadingSoon, запущенный
   * в обработчике ссылки), на кнопку открытия не возвращать. Если панель исчезла вместе с раскладкой, close не
   * наступает и afterClose не вызывается — поэтому фокус и ставится не отсюда.
   */
  afterClose?: () => boolean;
  /** Закреплённый низ панели вне прокручиваемой области (кнопка «Подробнее»). */
  footer?: ReactNode;
  /** «Закрыть» в левом углу (панель «Счета» на телефоне, §8.1 этапа 1.5); по умолчанию — справа. */
  closeAt?: 'left' | 'right';
  /**
   * Идёт запись (импорт, §5.1 спецификации импорта): Esc, «Закрыть» и касание фона панель не закрывают — как у формы
   * операции (решение 6b). «Закрыть» остаётся в порядке Tab с aria-disabled.
   */
  busy?: boolean;
  /** Широкая панель: 480 px на компьютере, на телефоне — на весь экран (импорт, §5.1 и §5.7 спецификации импорта). */
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Нажатие началось на фоне: выделение текста, отпущенное над фоном, панель не закрывает. */
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const busy = useRef(false);
  busy.current = props.busy === true;
  const close = () => {
    if (!busy.current) ref.current?.close();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  // фон (::backdrop) принадлежит самому <dialog>: щелчок по нему приходит с target === dialog,
  // а всё содержимое лежит во внутреннем блоке во всю высоту и ширину панели
  const side =
    props.side === 'left'
      ? 'ml-0 mr-auto starting:open:-translate-x-full'
      : 'ml-auto mr-0 starting:open:translate-x-full';
  // на телефоне цель касания 44 px (btnClose)
  const closeButton = (
    <button type="button" aria-label="Закрыть" aria-disabled={props.busy || undefined} onClick={close} className={`${btnClose} aria-disabled:opacity-50`}>
      <span aria-hidden="true">✕</span>
    </button>
  );
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        cycleTab(e, ref.current);
        // Esc во время записи: без отмены keydown браузер закрыл бы окно (повторный cancel отменить нельзя)
        if (e.key === 'Escape' && busy.current) e.preventDefault();
      }}
      onCancel={(e) => {
        if (busy.current && e.target === e.currentTarget) e.preventDefault();
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) close();
        pressedOnBackdrop.current = false;
      }}
      onClose={(e) => {
        // close вложенного окна (окно компании поверх панели «Компании») React доставляет и сюда
        if (e.target !== e.currentTarget) return;
        props.onClose();
        if (props.afterClose?.()) return;
        const back = opener.current;
        // кнопки открытия уже не видно (окно стало шире или уже телефона — она в display:none): фокус на заголовок страницы
        if (back?.isConnected && back.getClientRects().length > 0) back.focus();
        else focusPageHeading();
      }}
      className={`my-0 h-dvh max-h-none ${props.wide ? 'w-full md:w-[min(30rem,calc(100vw-3rem))]' : 'w-[min(22rem,calc(100vw-3rem))]'} max-w-none bg-card p-0 text-ink shadow-2xl transition-transform duration-200 backdrop:bg-black/40 motion-reduce:transition-none ${side}`}
    >
      {props.open && (
        <div
          className={`flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${props.side === 'left' ? 'pl-[env(safe-area-inset-left)]' : 'pr-[env(safe-area-inset-right)]'}`}
        >
          <div className={`flex items-center gap-3 px-4 pt-4 pb-2 ${props.closeAt === 'left' ? '' : 'justify-between'}`}>
            {props.closeAt === 'left' && closeButton}
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-xl font-bold">
                {props.title}
              </h2>
              {props.subtitle && <p className="truncate text-sm text-muted">{props.subtitle}</p>}
            </div>
            {props.closeAt !== 'left' && closeButton}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{props.children}</div>
          {props.footer && <div className="border-t border-field px-4 py-3">{props.footer}</div>}
        </div>
      )}
    </dialog>
  );
}
