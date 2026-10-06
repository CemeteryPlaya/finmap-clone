import { useId, type ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/** Подпись, подсказка и ошибка поля, связанные с элементом ввода: label for, aria-invalid, aria-describedby. */
export function Field(props: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
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
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {props.label}
      </label>
      {props.children(control)}
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
