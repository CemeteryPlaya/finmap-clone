import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { OperationType } from '../../lib/journal-filter';
import type { Company } from '../../lib/queries';
import { OperationForm } from './OperationForm';

/** Что открыть в форме операции: новую операцию заданного типа. */
export type OperationFormRequest = { kind: 'create'; type: OperationType };

const OpenContext = createContext<(request: OperationFormRequest) => void>(() => undefined);

/** Открыть форму операции из любого места страницы компании (кнопки шапки, журнал). */
export function useOpenOperationForm(): (request: OperationFormRequest) => void {
  return useContext(OpenContext);
}

/**
 * Форма операции на странице компании: одна на всю страницу, открывается кнопками «Доход», «Расход»,
 * «Перевод» в шапке. Каждое открытие — новая форма (key), закрытие возвращает фокус туда, откуда открыли.
 */
export function OperationFormHost(props: { company: Company; children: ReactNode }) {
  const [current, setCurrent] = useState<{ key: number; request: OperationFormRequest } | null>(null);
  const open = useCallback((request: OperationFormRequest) => setCurrent({ key: Date.now(), request }), []);
  return (
    <OpenContext.Provider value={open}>
      {props.children}
      {current && <OperationForm key={current.key} company={props.company} request={current.request} onClose={() => setCurrent(null)} />}
    </OpenContext.Provider>
  );
}

const BUTTONS: { type: OperationType; symbol: string; label: string; className: string }[] = [
  { type: 'income', symbol: '+', label: 'Доход', className: 'bg-income text-white' },
  { type: 'expense', symbol: '\u2212', label: 'Расход', className: 'bg-expense text-white' },
  { type: 'transfer', symbol: '⇄', label: 'Перевод', className: 'bg-chrome-2 text-white' },
];

/** Кнопки шапки «+ Доход», «- Расход», «⇄ Перевод» (§7 «Каркас»; у минуса — знак U+2212). */
export function NewOperationButtons() {
  const open = useOpenOperationForm();
  return (
    <div className="flex gap-2">
      {BUTTONS.map((b) => (
        <button
          key={b.type}
          type="button"
          aria-haspopup="dialog"
          onClick={() => open({ kind: 'create', type: b.type })}
          className={`rounded-xl px-3 py-2 text-sm font-semibold hover:brightness-110 ${b.className}`}
        >
          <span aria-hidden="true">{b.symbol}</span> {b.label}
        </button>
      ))}
    </div>
  );
}
