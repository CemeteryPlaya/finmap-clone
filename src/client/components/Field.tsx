import { useId, type ReactNode, type Ref } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/**
 * Плавающая подпись (§6.3 этапа 1.5): пустое поле — подпись на месте значения, как подсказка (и в фокусе тоже:
 * пустое поле в фокусе выглядит как крупная подсказка, как в Finmap); поле с значением (`data-filled`) — мелкая подпись
 * сверху на фоне поля (прокрученный текст многострочного поля под ней не просвечивает). Нажатие на подпись проходит
 * в поле (pointer-events-none); у недоступного поля подпись тускнеет вместе с ним. Цвет — `text-label` (5,4:1 на bg-field).
 */
const floatingLabelClass =
  'pointer-events-none absolute top-1/2 left-4 z-[1] max-w-[calc(100%-3.5rem)] -translate-y-1/2 truncate text-base text-label transition-all motion-reduce:transition-none group-has-[:disabled]/field:opacity-60 group-data-[filled]/field:top-2 group-data-[filled]/field:translate-y-0 group-data-[filled]/field:bg-field group-data-[filled]/field:text-xs';

/**
 * Подпись, подсказка и ошибка поля, связанные с элементом ввода: label for, aria-invalid, aria-describedby.
 * `floating` — подпись внутри рамки поля (§6.3 этапа 1.5); элемент ввода должен быть с `floatingControlClass`
 * (или своей рамкой высотой не меньше 56 px), `filled` — в поле есть значение. `boxRef` — рамка поля (от неё
 * выпадающий список считает место и ширину), `below` — содержимое под рамкой, до подсказки (ряд операторов суммы).
 */
export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  floating?: boolean;
  filled?: boolean;
  boxRef?: Ref<HTMLDivElement>;
  below?: ReactNode;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ');
  const control: FieldControlProps = {
    id,
    ...(props.error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
  return (
    <div className={props.className ?? 'block'}>
      {props.floating ? (
        <div ref={props.boxRef} data-filled={props.filled ? '' : undefined} className="group/field relative">
          {props.children(control)}
          <label htmlFor={id} className={floatingLabelClass}>
            {props.label}
          </label>
        </div>
      ) : (
        <>
          <label htmlFor={id} className="mb-1 block text-sm text-muted">
            {props.label}
          </label>
          {props.children(control)}
        </>
      )}
      {props.below}
      {props.hint && (
        <span id={hintId} className="mt-1 block text-xs text-muted">
          {props.hint}
        </span>
      )}
      {props.error && (
        <span id={errorId} className="mt-1 block text-sm text-expense">
          {props.error}
        </span>
      )}
    </div>
  );
}
