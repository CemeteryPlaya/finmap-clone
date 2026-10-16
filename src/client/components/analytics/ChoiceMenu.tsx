import type { ReactNode } from 'react';
import { pillClass, wideClass } from '../journal/PeriodMenu';
import { Caret, Popover } from '../Popover';

/** Пункт меню выбора: недоступный — с подсказкой (§2.3: шаг, который даёт больше 92 колонок). */
export interface Choice<T extends string> {
  value: T;
  label: string;
  disabled?: string;
}

/**
 * Пилюля выбора одного значения (разрез, шаг, проценты; §2.2 спецификации «Аналитика»), как меню периода: подпись — текущее
 * значение, пункты — кнопки с ✓ и aria-current у текущего. Недоступный пункт остаётся в порядке фокуса (aria-disabled),
 * под ним — подсказка. Имя кнопки — «{name}: {значение}».
 */
export function ChoiceMenu<T extends string>(props: { name: string; value: T; options: readonly Choice<T>[]; onChange: (value: T) => void; wide?: boolean }) {
  const current = props.options.find((o) => o.value === props.value)?.label ?? '';
  return (
    <Popover
      label={
        <>
          <span className="truncate">{current}</span>
          <Caret />
        </>
      }
      ariaLabel={`${props.name}: ${current}`}
      panelLabel={props.name}
      buttonClassName={props.wide ? wideClass : pillClass}
      panelClassName="w-72 pointer-coarse:w-[336px]"
    >
      {(close) => (
        <ul className="flex flex-col">
          {props.options.map((o) => {
            const selected = o.value === props.value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  aria-disabled={o.disabled ? true : undefined}
                  data-autofocus={selected ? '' : undefined}
                  onClick={() => {
                    if (o.disabled) return;
                    props.onChange(o.value);
                    close(true);
                  }}
                  className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-field focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-not-allowed ${selected ? 'font-semibold' : ''}`}
                >
                  <span className={o.disabled ? 'text-muted' : ''}>
                    {o.label}
                    {o.disabled && <span className="mt-0.5 block text-xs font-normal">{o.disabled}</span>}
                  </span>
                  {selected && (
                    <span aria-hidden="true" className="text-income">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Popover>
  );
}

/**
 * Точка у контрола, который отличается от значения по умолчанию (§2.2, как у Finmap). Для программ чтения — «Сбросить»
 * рядом; сама точка только рисунок. `data-changed` — для проверок.
 */
export function ChangedMark(props: { on: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <span data-changed={props.on ? '' : undefined} className={`relative ${props.wide ? 'block' : 'inline-flex max-w-full'}`}>
      {props.children}
      {props.on && <span aria-hidden="true" className="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-income ring-2 ring-card" />}
    </span>
  );
}
