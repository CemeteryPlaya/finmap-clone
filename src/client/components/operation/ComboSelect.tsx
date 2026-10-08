import { Field } from '../Field';
import { Popover } from '../Popover';
import { PickerList, type PickerOption } from '../SearchPicker';

/** Пункт «без значения» в списке: id справочников всегда положительные. */
const NONE = 0;

export const selectButtonClass =
  'flex w-full items-center justify-between gap-2 rounded-xl bg-field px-4 py-3 text-left outline-none focus:ring-2 focus:ring-focus disabled:opacity-60';

/**
 * Выпадающий список с поиском для поля формы (§7): кнопка с текущим значением, по нажатию — панель с поиском
 * (без учёта регистра и «ё»), пункт «без значения» и, с `onCreate`, «+ Создать „…“». Имя кнопки —
 * «Подпись: значение», подпись поля и ошибка связаны с кнопкой через `Field`.
 */
export function ComboSelect(props: {
  label: string;
  /** Название списка для программ чтения с экрана: «Статьи». */
  listLabel: string;
  value: number | null;
  options: PickerOption[];
  /** Подпись пустого значения: «Без статьи». null — пустого значения нет (счёт). */
  emptyLabel: string | null;
  placeholder?: string;
  onChange: (id: number | null) => void;
  onCreate?: (name: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = props.options.find((o) => o.id === props.value);
  const text = selected?.label ?? (props.value === null ? (props.emptyLabel ?? props.placeholder ?? 'Выберите') : '…');
  const options = props.emptyLabel === null ? props.options : [{ id: NONE, label: props.emptyLabel }, ...props.options];
  return (
    <Field label={props.label} error={props.error} hint={props.hint} className={props.className}>
      {(control) => (
        <Popover
          control={control}
          label={
            <>
              <span className={`truncate ${props.value === null ? 'text-muted' : ''}`}>{text}</span>
              <span aria-hidden="true" className="text-muted">
                ▾
              </span>
            </>
          }
          ariaLabel={`${props.label}: ${text}`}
          panelLabel={props.listLabel}
          buttonClassName={selectButtonClass}
          disabled={props.disabled}
          panelClassName="w-80"
        >
          {(close) => (
            <PickerList
              label={props.listLabel}
              options={options}
              selectedId={props.value ?? (props.emptyLabel === null ? null : NONE)}
              onPick={(id) => {
                close(true);
                props.onChange(id === NONE ? null : id);
              }}
              onCreate={
                props.onCreate &&
                ((name) => {
                  close(true);
                  props.onCreate!(name);
                })
              }
            />
          )}
        </Popover>
      )}
    </Field>
  );
}
