import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { OperationType } from '../../lib/journal-filter';
import type { OperationPrefill } from '../../lib/operation-form';
import type { Company } from '../../lib/queries';
import { OperationForm } from './OperationForm';

/** Что открыть в форме операции: новую операцию заданного типа или существующую по id. */
export type OperationFormRequest =
  | {
      kind: 'create';
      type: OperationType;
      /** «Оплатить» у поступления склада: расход с поставщиком, суммой и оплатой документа. */
      prefill?: OperationPrefill;
    }
  | {
      kind: 'edit';
      id: number;
      /** Куда поставить фокус, если операцию удалили (строки, с которой открыли форму, больше нет). */
      focusAfterDelete?: () => HTMLElement | null;
    };

const OpenContext = createContext<(request: OperationFormRequest) => void>(() => undefined);

/** Открыть форму операции из любого места страницы компании (кнопки шапки, журнал). */
export function useOpenOperationForm(): (request: OperationFormRequest) => void {
  return useContext(OpenContext);
}

/**
 * Форма операции на странице компании: одна на всю страницу, открывается кнопками «Доход», «Расход»,
 * «Перевод» в шапке и строкой журнала. Каждое открытие — новая форма (key), закрытие возвращает фокус туда, откуда открыли.
 */
export function OperationFormHost(props: { company: Company; children: ReactNode }) {
  const [current, setCurrent] = useState<{ key: number; request: OperationFormRequest } | null>(null);
  const counter = useRef(0);
  const open = useCallback((request: OperationFormRequest) => setCurrent({ key: ++counter.current, request }), []);
  return (
    <OpenContext.Provider value={open}>
      {props.children}
      {current && <OperationForm key={current.key} company={props.company} request={current.request} onClose={() => setCurrent(null)} />}
    </OpenContext.Provider>
  );
}

const BUTTONS: { type: OperationType; symbol: string; label: string; className: string }[] = [
  { type: 'income', symbol: '+', label: 'Доход', className: 'bg-income/20 text-income-on-dark' },
  { type: 'expense', symbol: '\u2212', label: 'Расход', className: 'bg-expense/20 text-expense-on-dark' },
  { type: 'transfer', symbol: '⇄', label: 'Перевод', className: 'bg-white/10 text-white' },
];

/**
 * Кнопки новых операций (§3.1, §8.2 этапа 1.5; у минуса — знак U+2212) — одна разметка на обе ширины: группа
 * «Добавить операцию» в шапке. На компьютере — по центру шапки, одинаковой ширины, «+ Доход», «\u2212 Расход», «⇄ Перевод»;
 * на телефоне — второй строкой шапки во всю ширину, только значки, 44 px. Имя кнопки — `aria-label`, подсказка — `title`.
 */
export function NewOperationButtons() {
  const open = useOpenOperationForm();
  return (
    <div role="group" aria-label="Добавить операцию" className="grid grid-cols-3 gap-3 max-md:gap-4">
      {BUTTONS.map((b) => (
        <button
          key={b.type}
          type="button"
          aria-haspopup="dialog"
          aria-label={b.label}
          title={b.label}
          onClick={() => open({ kind: 'create', type: b.type })}
          className={`rounded-xl px-8 py-2.5 text-base font-semibold whitespace-nowrap hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-md:h-11 max-md:px-2 max-md:py-0 max-md:text-xl ${b.className}`}
        >
          <span aria-hidden="true">{b.symbol}</span>
          <span aria-hidden="true" className="max-md:hidden">
            {' '}
            {b.label}
          </span>
        </button>
      ))}
    </div>
  );
}
