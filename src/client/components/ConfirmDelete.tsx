import { btnDanger, btnSecondary } from './ui';

/** Встроенное подтверждение удаления (без window.confirm); фокус сразу на безопасной «Отмене». */
export function ConfirmDelete(props: { what: string; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={`Удаление: ${props.what}`} className="flex flex-wrap items-center gap-2 text-sm">
      <span>Удалить {props.what}? Это нельзя отменить.</span>
      <button type="button" disabled={props.pending} onClick={props.onConfirm} className={btnDanger}>
        Да, удалить
      </button>
      <button type="button" autoFocus onClick={props.onCancel} className={btnSecondary}>
        Отмена
      </button>
    </div>
  );
}
