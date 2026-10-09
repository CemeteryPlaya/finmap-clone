import { useEffect, useRef } from 'react';

/** Сколько висит тост «Удалено N — Отменить» (§7). */
export const UNDO_TOAST_MS = 10_000;

/**
 * Тост после массового удаления. Область `role="status"` есть на странице всегда — так программа чтения
 * с экрана объявляет появившийся текст. Фокус переходит на «Отменить» (выбранные строки и кнопка
 * подтверждения исчезли); когда тост закрывается, фокус, если был в нём, уходит на заголовок журнала.
 */
export function UndoToast(props: {
  toast: { key: number; count: number } | null;
  pending: boolean;
  onUndo: () => void;
  onClose: () => void;
  focusAfter: () => HTMLElement | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const focusAfter = useRef(props.focusAfter);
  focusAfter.current = props.focusAfter;

  const finish = (action: () => void) => {
    const hadFocus = rootRef.current?.contains(document.activeElement) ?? false;
    action();
    if (hadFocus) focusAfter.current()?.focus();
  };

  const key = props.toast?.key;
  useEffect(() => {
    if (key === undefined) return;
    undoRef.current?.focus();
    const t = setTimeout(() => finish(() => onClose.current()), UNDO_TOAST_MS);
    return () => clearTimeout(t);
  }, [key]);

  return (
    <div ref={rootRef} role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 md:bottom-6">
      {props.toast && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-ink px-5 py-3 text-sm text-white shadow-2xl">
          <span>Удалено {props.toast.count}</span>
          <button ref={undoRef} type="button" disabled={props.pending} onClick={() => finish(props.onUndo)} className="font-semibold text-income-soft underline">
            Отменить
          </button>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => finish(props.onClose)} className="text-white/70 hover:text-white">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
    </div>
  );
}
