import { useId, type ReactNode, type Ref } from 'react';

/** Вид строки-действия (§6.7 этапа 1.5): на всю ширину, иконка слева, текст; разделитель — у обёртки. */
export const actionRowClass =
  'flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-3 text-left text-base outline-none hover:bg-canvas focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent';

/**
 * Строка-действие под полями формы операции (§6.7, §11 этапа 1.5): обычная `<button>` с текстом. Раскрывающая —
 * с `aria-expanded`; неактивная — `aria-disabled` с подсказкой в `aria-describedby` (видна под строкой), остаётся
 * в порядке Tab и ничего не делает; `info` — ⓘ справа: подсказка при наведении и описание для программ чтения.
 */
export function ActionRow(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  expanded?: boolean;
  danger?: boolean;
  disabledHint?: string;
  info?: string;
  /** Текст приглушён (месяц зарплаты по умолчанию, план 1.5-3c). */
  muted?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const hintId = useId();
  const infoId = useId();
  const describedBy = [props.disabledHint ? hintId : null, props.info ? infoId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="relative border-b border-field">
      <button
        ref={props.buttonRef}
        type="button"
        aria-expanded={props.expanded}
        aria-disabled={props.disabledHint ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => {
          if (!props.disabledHint) props.onClick();
        }}
        className={`peer ${actionRowClass} ${props.danger ? 'text-expense' : 'text-ink'}`}
      >
        <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center ${props.danger ? 'text-expense' : 'text-muted'}`}>
          {props.icon}
        </span>
        <span className={`min-w-0 flex-1 ${props.muted ? 'text-muted' : ''}`}>{props.label}</span>
        {props.info && (
          <span aria-hidden="true" title={props.info} className="grid size-6 shrink-0 place-items-center text-muted">
            ⓘ
          </span>
        )}
      </button>
      {/* с клавиатуры подсказка ⓘ видна, пока строка в фокусе (мышью — всплывающая подсказка у значка); читают её по aria-describedby */}
      {props.info && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-full right-0 z-10 mt-1 hidden max-w-64 rounded-lg bg-chrome px-3 py-2 text-sm text-white shadow-lg peer-focus-visible:block"
        >
          {props.info}
        </span>
      )}
      {props.disabledHint && (
        <span id={hintId} className="block px-1 pb-2 text-sm text-muted">
          {props.disabledHint}
        </span>
      )}
      {props.info && (
        <span id={infoId} className="sr-only">
          {props.info}
        </span>
      )}
    </div>
  );
}
