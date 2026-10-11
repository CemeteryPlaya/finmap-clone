import { createProps, type CreateProps, type PickerOption } from '../../lib/picker';
import { useComboList } from '../ComboList';
import { Field } from '../Field';
import { useAutoFocus } from '../useAutoFocus';
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
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** Подсказка пустого закрытого поля («Не менять» в окне «Изменить данные»); с ней подпись всегда мелкая сверху. */
  emptyText?: string;
  className?: string;
  /** Фокус в поле при появлении, если он «ничей» (§6.2 этапа 1.5: пустой счёт при открытии формы). */
  autoFocus?: boolean;
} & CreateProps<void | Promise<boolean>> /* «+ Создать»: onCreate вместе с createNoun («категорию»); обещание с false — создать не удалось, набранное название остаётся в поле */) {
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
    ...createProps(props),
  });
  useAutoFocus(combo.inputProps.ref, props.autoFocus);
  const suffix = combo.open ? undefined : selected?.suffix;
  const placeholder = combo.inputProps.placeholder ?? (text === '' ? props.emptyText : undefined);
  const filled = combo.inputProps.value !== '' || placeholder !== undefined;
  return (
    <Field
      label={props.label}
      error={props.error}
      hint={props.hint}
      className={props.className}
      floating
      // подпись поднимается, когда в поле есть что показать (значение, набранное, подсказка); пустое открытое поле — крупная подпись (Finmap 09)
      filled={filled}
      boxRef={combo.anchorRef}
    >
      {(control) => (
        <>
          <input
            {...control}
            {...combo.inputProps}
            placeholder={placeholder}
            disabled={props.disabled}
            // названия вводятся с заглавной буквы; автозамена и проверка правописания не должны менять имя для «+ Создать»
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="sentences"
            className={`${floatingControlClass} truncate ${suffix ? 'pr-20' : 'pr-10'}`}
          />
          {/* символ валюты выбранного счёта — справа в закрытом поле на строке значения (pt-5 pb-1: центр на 0,5 rem ниже), только для глаз */}
          {suffix && (
            <span aria-hidden="true" className="pointer-events-none absolute top-[calc(50%+0.5rem)] right-10 -translate-y-1/2 text-label">
              {suffix}
            </span>
          )}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute right-4 -translate-y-1/2 text-muted ${filled ? 'top-[calc(50%+0.5rem)]' : 'top-1/2'}`}
          >
            ▾
          </span>
          {combo.list}
        </>
      )}
    </Field>
  );
}
