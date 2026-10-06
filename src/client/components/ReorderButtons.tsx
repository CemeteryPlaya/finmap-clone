import { btnIcon } from './ui';

/** «Выше» / «Ниже» — доступная с клавиатуры замена перетаскиванию. null — двигать некуда. */
export function ReorderButtons(props: { label: string; onUp: (() => void) | null; onDown: (() => void) | null; disabled?: boolean }) {
  const disabled = props.disabled ?? false;
  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        aria-label={`Выше: ${props.label}`}
        title="Выше"
        disabled={disabled || !props.onUp}
        onClick={props.onUp ?? undefined}
        className={btnIcon}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Ниже: ${props.label}`}
        title="Ниже"
        disabled={disabled || !props.onDown}
        onClick={props.onDown ?? undefined}
        className={btnIcon}
      >
        ↓
      </button>
    </span>
  );
}
