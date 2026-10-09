import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { OperationType } from '../../lib/journal-filter';
import type { Company } from '../../lib/queries';
import { OperationForm } from './OperationForm';

/** Что открыть в форме операции: новую операцию заданного типа или существующую по id. */
export type OperationFormRequest =
  | { kind: 'create'; type: OperationType }
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
  { type: 'income', symbol: '+', label: 'Доход', className: 'bg-income text-white' },
  { type: 'expense', symbol: '\u2212', label: 'Расход', className: 'bg-expense text-white' },
  { type: 'transfer', symbol: '⇄', label: 'Перевод', className: 'bg-chrome-2 text-white' },
];

/**
 * Кнопки «+ Доход», «- Расход», «⇄ Перевод» (§7; у минуса — знак U+2212). `header` — в шапке, только на компьютере;
 * `bottom` — на телефоне (меньше 768 px) панель, закреплённая у нижнего края экрана (§7 «Мобильная версия»).
 */
export function NewOperationButtons({ placement = 'header' }: { placement?: 'header' | 'bottom' }) {
  const open = useOpenOperationForm();
  const buttons = BUTTONS.map((b) => (
    <button
      key={b.type}
      type="button"
      aria-haspopup="dialog"
      onClick={() => open({ kind: 'create', type: b.type })}
      className={`rounded-xl font-semibold hover:brightness-110 ${placement === 'header' ? 'px-3 py-2 text-sm' : 'px-2 py-3 text-base'} ${b.className}`}
    >
      <span aria-hidden="true">{b.symbol}</span> {b.label}
    </button>
  ));
  if (placement === 'header') return <div className="hidden gap-2 md:flex">{buttons}</div>;
  return (
    <div
      role="group"
      aria-label="Добавить операцию"
      // над «домашней» полосой iPhone и с учётом выреза в горизонтальном положении
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-2 bg-chrome pt-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-4px_16px_rgb(0_0_0/0.15)] md:hidden"
    >
      {buttons}
    </div>
  );
}
