import type { PickerOption } from '../../lib/picker';
import { useComboList } from '../ComboList';
import { Field } from '../Field';
import { floatingControlClass } from '../ui';

/** Пункт «без значения» в списке: id справочников всегда положительные. */
const NONE = 0;

/**
 * Поле со списком формы (§6.6 этапа 1.5): поле ввода с плавающей подписью (§6.3), печать фильтрует список
 * (без учёта регистра и «ё»), пункт «без значения» («Без категории»), с `onCreate` — «+ Создать». Имя поля — подпись,
 * значение — название выбранного; пустое значение не пишется текстом — видна подпись. Подпись, подсказка и ошибка
 * связаны с полем через `Field`. Клавиши — `useComboList`.
 */
export function ComboSelect(props: {
  label: string;
  /** Название списка для программ чтения с экрана: «Категории». */
  listLabel: string;
  value: number | null;
  options: PickerOption[];
  /** Пункт пустого значения в списке: «Без категории». null — пустого значения нет (счёт). */
  emptyLabel: string | null;
  onChange: (id: number | null) => void;
  onCreate?: (name: string) => void;
  /** Что создаёт «+ Создать»: «категорию», «контрагента», «проект». Обязательно вместе с onCreate. */
  createNoun?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** Подсказка пустого закрытого поля («Не менять» в окне «Изменить данные»); с ней подпись всегда мелкая сверху. */
  emptyText?: string;
  className?: string;
}) {
  const selected = props.options.find((o) => o.id === props.value);
  // значение есть, а пункта нет (справочник ещё грузится) — «…»
  const text = selected?.label ?? (props.value === null ? '' : '…');
  const options = props.emptyLabel === null ? props.options : [{ id: NONE, label: props.emptyLabel }, ...props.options];
  const combo = useComboList({
    listLabel: props.listLabel,
    options,
    selectedId: props.value ?? (props.emptyLabel === null ? null : NONE),
    text,
    onPick: (id) => props.onChange(id === NONE ? null : id),
    onCreate: props.onCreate,
    createNoun: props.createNoun,
  });
  const suffix = combo.open ? undefined : selected?.suffix;
  return (
    <Field
      label={props.label}
      error={props.error}
      hint={props.hint}
      className={props.className}
      floating
      filled={combo.open || text !== '' || props.emptyText !== undefined}
      boxRef={combo.anchorRef}
    >
      {(control) => (
        <>
          <input
            {...control}
            {...combo.inputProps}
            placeholder={combo.inputProps.placeholder ?? (text === '' ? props.emptyText : undefined)}
            disabled={props.disabled}
            className={`${floatingControlClass} truncate ${suffix ? 'pr-20' : 'pr-10'}`}
          />
          {/* символ валюты выбранного счёта — справа в закрытом поле, только для глаз (значение поля — название) */}
          {suffix && (
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-10 -translate-y-1/2 text-label">
              {suffix}
            </span>
          )}
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-muted">
            ▾
          </span>
          {combo.list}
        </>
      )}
    </Field>
  );
}
