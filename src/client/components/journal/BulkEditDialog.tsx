import { useState } from 'react';
import type { AssignData } from '../../lib/journal-assign';
import { bulkEditActions, type BulkEditAction, type BulkEditValues } from '../../lib/journal-bulk';
import { categoryOptions, counterpartyOptions, projectOptions } from '../../lib/operation-options';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { btnPrimary } from '../ui';

const NOTHING: BulkEditValues = { counterpartyId: null, categoryId: null, projectId: null };

function BulkEditForm(props: { count: number; data: AssignData; onSave: (actions: BulkEditAction[]) => void }) {
  const [values, setValues] = useState<BulkEditValues>(NOTHING);
  const actions = bulkEditActions(values);
  const set = (key: keyof BulkEditValues) => (id: number | null) => setValues((v) => ({ ...v, [key]: id }));
  // категории обоих видов — группами: каждой операции подойдёт категория её вида, остальные сервер пропустит
  const categories = [
    ...categoryOptions(props.data.categories, 'income', []).map((o) => ({ ...o, section: 'Доходы' })),
    ...categoryOptions(props.data.categories, 'expense', []).map((o) => ({ ...o, section: 'Расходы' })),
  ];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (actions.length > 0) props.onSave(actions);
      }}
      className="flex flex-col gap-4"
    >
      <p className="-mt-2 text-sm text-muted">Выбрано: {props.count}</p>
      <ComboSelect
        label="Контрагент"
        listLabel="Контрагенты"
        value={values.counterpartyId}
        options={counterpartyOptions(props.data.counterparties, null, null)}
        emptyLabel="Не менять"
        emptyText="Не менять"
        onChange={set('counterpartyId')}
      />
      <ComboSelect label="Категория" listLabel="Категории" value={values.categoryId} options={categories} emptyLabel="Не менять" emptyText="Не менять" onChange={set('categoryId')} />
      <ComboSelect label="Проект" listLabel="Проекты" value={values.projectId} options={projectOptions(props.data.projects, [])} emptyLabel="Не менять" emptyText="Не менять" onChange={set('projectId')} />
      <p className="text-xs text-muted">Меняются только заполненные поля. Разбитые операции и переводы, которым поле не подходит, пропускаются — итог покажет причины.</p>
      <button type="submit" disabled={actions.length === 0} className={`${btnPrimary} w-full py-3`}>
        Сохранить
      </button>
    </form>
  );
}

/**
 * «Изменить данные» (§5.5 этапа 1.5): три необязательных поля — «Контрагент», «Категория» (доходы и расходы
 * группами), «Проект»; «Сохранить» недоступна, пока ничего не выбрано. По «Сохранить» окно закрывается сразу,
 * действия выполняет владелец. Окно живёт на странице журнала, а не в полосе действий: полоса исчезает вместе
 * с выделением, а открытый `<dialog>` нельзя просто убрать со страницы.
 */
export function BulkEditDialog(props: {
  open: boolean;
  count: number;
  data: AssignData;
  onClose: () => void;
  onSave: (actions: BulkEditAction[]) => void;
  /** Куда вернуть фокус, если «Изменить данные» уже нет (выделение опустело при открытом окне). */
  returnFocus?: () => HTMLElement | null;
}) {
  return (
    <Modal open={props.open} title="Изменить данные" onClose={props.onClose} className="max-w-[480px]" returnFocus={props.returnFocus}>
      <BulkEditForm count={props.count} data={props.data} onSave={props.onSave} />
    </Modal>
  );
}
