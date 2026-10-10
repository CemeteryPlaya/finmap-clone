import { useEffect, useId, useRef } from 'react';
import { cycleTab } from './focus-trap';
import { btnDanger, btnSecondary } from './ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  text: string;
  /** Кнопка действия справа: «Закрыть», «Удалить», «Изменить». */
  confirmLabel: string;
  /** Действие разрушительное: красная кнопка. */
  danger?: boolean;
  /** Флажок под текстом (только в вопросе о несохранённом — «Больше не спрашивать»). */
  checkbox?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  /** Идёт запрос действия: обе кнопки недоступны, Esc не закрывает. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Элемент, с которого открыли подтверждение, исчез (или фокус был на body): куда вернуть фокус (например, в поле суммы). */
  onFocusLost?: () => void;
}

/**
 * Вложенное окно подтверждения (§2.4, §11 этапа 1.5): `<dialog role="alertdialog">` через showModal() поверх
 * родительского окна. Кнопки в порядке Finmap: слева «Отменить» (фокус по умолчанию), справа действие.
 * Esc = «Отменить»: закрывается только подтверждение — клавиши и события close/cancel дальше не идут
 * (React доставил бы их обработчикам родительского `<dialog>`). Открыто, пока владелец держит `open`.
 * После закрытия фокус возвращается на элемент, с которого открыли, а если его уже нет — `onFocusLost`.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const titleId = useId();
  const textId = useId();
  const checkId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  const cancel = () => {
    if (!latest.current.pending) latest.current.onCancel();
  };

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onKeyDown={(e) => {
        cycleTab(e, ref.current);
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
        // ни Tab по кругу, ни Esc родительского окна не должны видеть клавиши подтверждения
        e.stopPropagation();
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
      onClose={(e) => {
        e.stopPropagation();
        if (e.target !== e.currentTarget) return;
        const back = opener.current;
        opener.current = null;
        if (back?.isConnected && back !== document.body) back.focus();
        // фокус был «ничей» (body), элемента уже нет или он не принял фокус — решает владелец (форма: поле суммы)
        if (!back?.isConnected || back === document.body || document.activeElement !== back) latest.current.onFocusLost?.();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-card p-6 text-ink shadow-2xl backdrop:bg-black/40"
    >
      {props.open && (
        <>
          <h2 id={titleId} className="mb-3 text-xl font-bold">
            {props.title}
          </h2>
          <p id={textId} className="mb-4 text-sm text-muted">
            {props.text}
          </p>
          {props.checkbox && (
            <label htmlFor={checkId} className="mb-5 flex items-center gap-2 text-sm">
              <input
                id={checkId}
                type="checkbox"
                checked={props.checkbox.checked}
                disabled={props.pending}
                onChange={(e) => props.checkbox!.onChange(e.target.checked)}
              />
              {props.checkbox.label}
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button ref={cancelRef} type="button" disabled={props.pending} onClick={cancel} className={btnSecondary}>
              Отменить
            </button>
            <button type="button" disabled={props.pending} onClick={() => props.onConfirm()} className={props.danger ? btnDanger : btnSecondary}>
              {props.confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
