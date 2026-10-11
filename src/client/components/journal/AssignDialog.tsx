import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import {
  ASSIGN_CREATE_NOUNS,
  ASSIGN_LABELS,
  ASSIGN_LIST_LABELS,
  ASSIGN_TITLES,
  assignCreate,
  assignLabel,
  assignOptions,
  type AssignData,
  type AssignField,
} from '../../lib/journal-assign';
import { createFromForm } from '../../lib/operation-create';
import type { JournalItem } from '../../lib/queries';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { alertClass, btnPrimary } from '../ui';

export interface AssignRequest {
  item: JournalItem;
  field: AssignField;
}

/** Кнопка открытия операции в строке журнала (ячейка даты, `data-row-open`), если строка на странице. */
export function rowOpenButton(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`tr[data-operation-id="${id}"] [data-row-open]`);
}

/** Плашка «Указать» в пустой ячейке (§5.2, §5.4 этапа 1.5): видна всегда, открывает окно «Редактирование …». */
export function AssignChip(props: { field: AssignField; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={ASSIGN_LABELS[props.field]}
      onClick={props.onClick}
      className="rounded-md bg-income-soft px-2 py-0.5 text-xs font-medium text-income-strong hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
    >
      Указать
    </button>
  );
}

function AssignForm(props: { companyId: number; request: AssignRequest; data: AssignData; onSave: (id: number) => void }) {
  const { item, field } = props.request;
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // создание идёт: повторный Enter или нажатие не создают второй раз
  const creating = useRef(false);
  // список строится один раз на окно, а не на каждую перерисовку журнала; новый элемент справочника его обновит
  const options = useMemo(() => assignOptions(item, field, props.data), [item, field, props.data]);
  /** «+ Создать „…“» (§5.4, §6.6): элемент создаётся и выбирается в поле; операция меняется только по «Сохранить». */
  const create = async (name: string): Promise<boolean> => {
    if (creating.current) return true;
    creating.current = true;
    setError(null);
    const c = assignCreate(item, field, props.data.categories);
    try {
      setValue(await createFromForm(props.companyId, c.what, name, { kind: c.kind, counterpartyType: c.counterpartyType }));
      return true;
    } catch (e) {
      setError(`Не удалось создать «${name}»: ${e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера'}`);
      return false;
    } finally {
      creating.current = false;
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value !== null) props.onSave(value);
      }}
    >
      <ComboSelect
        label={assignLabel(item, field, props.data.categories)}
        listLabel={ASSIGN_LIST_LABELS[field]}
        value={value}
        options={options}
        emptyLabel={null}
        onChange={(id) => {
          setError(null);
          setValue(id);
        }}
        onCreate={create}
        createNoun={ASSIGN_CREATE_NOUNS[field]}
      />
      {error && (
        <p role="alert" className={`${alertClass} mt-3 mb-0`}>
          {error}
        </p>
      )}
      <button type="submit" disabled={value === null} className={`${btnPrimary} mt-6 w-full py-3`}>
        Сохранить
      </button>
    </form>
  );
}

/**
 * «Указать» (§5.4 этапа 1.5): окно по центру, 480 px — «Редактирование контрагента / категории / проекта», одно поле
 * со списком (тот же комбобокс, что в форме) и «Сохранить», недоступная, пока ничего не выбрано. По «Сохранить» окно
 * закрывается, значение применяет владелец (оптимистично, с version); фокус — на кнопку открытия операции в той же
 * строке: плашки уже нет. Esc и «×» закрывают без изменений, фокус — на плашке.
 */
export function AssignDialog(props: { companyId: number; request: AssignRequest | null; data: AssignData; onSave: (request: AssignRequest, id: number) => void; onClose: () => void }) {
  // строка, где сохранили: туда возвращается фокус; Esc и «×» — null (фокус на плашку)
  const savedId = useRef<number | null>(null);
  useEffect(() => {
    if (!props.request) return;
    savedId.current = null;
  }, [props.request]);
  return (
    <Modal
      open={props.request !== null}
      title={props.request ? ASSIGN_TITLES[props.request.field] : ''}
      onClose={props.onClose}
      className="max-w-[480px]"
      returnFocus={() => (savedId.current === null ? null : rowOpenButton(savedId.current))}
    >
      {props.request && (
        <AssignForm
          companyId={props.companyId}
          key={`${props.request.item.id}-${props.request.field}`}
          request={props.request}
          data={props.data}
          onSave={(id) => {
            const request = props.request!;
            savedId.current = request.item.id;
            props.onSave(request, id);
          }}
        />
      )}
    </Modal>
  );
}
