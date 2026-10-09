import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cycleTab } from './focus-trap';

/**
 * Модальное окно на `<dialog>`: открывается через showModal() — браузер держит фокус внутри окна,
 * делает остальную страницу недоступной и закрывает окно по Esc. При закрытии фокус возвращается
 * на элемент, с которого окно открыли. Содержимое монтируется заново при каждом открытии.
 * С `onCancel` окно по Esc само не закрывается: решает владелец (например, спрашивает про несохранённые изменения).
 */
export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
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

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        // Tab по кругу внутри окна: фокус не уходит в адресную строку браузера
        cycleTab(e, ref.current);
        // Esc, который не обработали внутри (список с поиском закрывается сам и отменяет событие)
        if (e.key !== 'Escape' || !props.onCancel || e.defaultPrevented) return;
        e.preventDefault();
        props.onCancel();
      }}
      onCancel={(e) => {
        if (!props.onCancel) return;
        e.preventDefault();
        props.onCancel();
      }}
      onClose={() => {
        props.onClose();
        opener.current?.focus();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] rounded-3xl bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40 ${props.className ?? 'max-w-2xl'}`}
    >
      {props.open && (
        <div className="p-6">
          <h2 id={titleId} className="mb-4 text-xl font-bold">
            {props.title}
          </h2>
          {props.children}
        </div>
      )}
    </dialog>
  );
}
