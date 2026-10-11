import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { alertClass, btnDanger, btnSecondary } from './ui';

/**
 * Ряд действий под формой окна правки (§7.1 этапа 1.5): «В архив» / «Вернуть из архива» и «Удалить».
 * «Удалить» спрашивает вложенный ConfirmDialog «Удалить {что}?» — «Отменить | Удалить» (решение 4 плана 1.5-1).
 * Удалось — владелец закрывает окно; не удалось — подтверждение закрывается, ошибка видна здесь, фокус на «Удалить»
 * (ставится, когда запрос закончился и кнопка снова доступна: подтверждение может закрыться раньше).
 */
export function EntityActions(props: {
  /** Сейчас в архиве — кнопка «Вернуть из архива». */
  archived?: boolean;
  /** Нет — кнопки архива нет. */
  onArchiveToggle?: () => void;
  /** Что удаляется, для вопроса: «тег «Ёлка»». */
  what: string;
  /** true — удалено. Нет — кнопки «Удалить» нет. */
  onDelete?: () => Promise<boolean>;
  pending: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refocus, setRefocus] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const remove = props.onDelete;

  // удаление не прошло: фокус на «Удалить», когда подтверждение закрыто и запрос закончился (кнопка снова доступна)
  useEffect(() => {
    if (!refocus || confirming || props.pending) return;
    setRefocus(false);
    deleteRef.current?.focus({ preventScroll: true });
  }, [refocus, confirming, props.pending]);

  return (
    <div className="mt-6 grid gap-3 border-t border-field pt-4">
      {props.error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {props.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {props.onArchiveToggle && (
          // aria-disabled, а не disabled: после отказа сервера фокус остаётся на кнопке
          <button
            type="button"
            aria-disabled={props.pending || undefined}
            onClick={() => {
              if (!props.pending) props.onArchiveToggle?.();
            }}
            className={`${btnSecondary} aria-disabled:opacity-50`}
          >
            {props.archived ? 'Вернуть из архива' : 'В архив'}
          </button>
        )}
        {remove && (
          <button ref={deleteRef} type="button" disabled={props.pending} onClick={() => setConfirming(true)} className={btnDanger}>
            Удалить
          </button>
        )}
      </div>
      {remove && (
        <ConfirmDialog
          open={confirming}
          title={`Удалить ${props.what}?`}
          text="Это нельзя отменить."
          confirmLabel="Удалить"
          danger
          pending={props.pending}
          onConfirm={() =>
            void remove().then((ok) => {
              setConfirming(false);
              if (!ok) setRefocus(true);
            })
          }
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/** Окно архивного элемента: вместо формы — пояснение (правка архивного запрещена правилами этапа 1). */
export function ArchivedNote() {
  return <p className="text-sm text-muted">В архиве. Чтобы изменить, сначала верните из архива.</p>;
}
