import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cycleTab } from './focus-trap';
import { btnIcon } from './ui';

/**
 * Выезжающая панель (§7 «Мобильная версия»): модальное окно `<dialog>` у левого или правого края экрана.
 * showModal() делает остальную страницу недоступной, Tab и Shift+Tab ходят по кругу внутри панели (не уходят
 * в адресную строку браузера); Esc, «Закрыть»
 * и касание затемнённого фона закрывают панель, фокус возвращается на кнопку, которой её открыли.
 * Отступы учитывают вырезы экрана (safe-area). Содержимое монтируется заново при каждом открытии.
 */
export function Drawer(props: { open: boolean; title: string; side: 'left' | 'right'; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Нажатие началось на фоне: выделение текста, отпущенное над фоном, панель не закрывает. */
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

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
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => cycleTab(e, ref.current)}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) ref.current?.close();
        pressedOnBackdrop.current = false;
      }}
      onClose={() => {
        props.onClose();
        opener.current?.focus();
      }}
      className={`my-0 h-dvh max-h-none w-[min(22rem,calc(100vw-3rem))] max-w-none bg-card p-0 text-ink shadow-2xl transition-transform duration-200 backdrop:bg-black/40 motion-reduce:transition-none ${side}`}
    >
      {props.open && (
        <div
          className={`flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${props.side === 'left' ? 'pl-[env(safe-area-inset-left)]' : 'pr-[env(safe-area-inset-right)]'}`}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <h2 id={titleId} className="text-xl font-bold">
              {props.title}
            </h2>
            <button type="button" aria-label="Закрыть" onClick={() => ref.current?.close()} className={btnIcon}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{props.children}</div>
        </div>
      )}
    </dialog>
  );
}
