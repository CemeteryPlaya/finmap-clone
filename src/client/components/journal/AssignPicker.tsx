import { useMemo } from 'react';
import { ASSIGN_LABELS, type AssignField } from '../../lib/journal-assign';
import type { CategoryNode, CategoryTree, Counterparty, JournalItem, Project } from '../../lib/queries';
import { SearchPicker, type PickerOption } from '../SearchPicker';

export interface AssignData {
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
}

/** Категории для выбора: без архивных, дочерние — «Родитель → Дочерняя». */
export function categoryPickerOptions(nodes: CategoryNode[]): PickerOption[] {
  return nodes
    .filter((n) => !n.archivedAt)
    .flatMap((n) => [{ id: n.id, label: n.name }, ...n.children.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: `${n.name} → ${c.name}` }))]);
}

/** Варианты «Указать»: архивные не предлагаются (инвариант 7); категории — только вида операции (инвариант 3). */
function optionsFor(item: JournalItem, field: AssignField, data: AssignData): PickerOption[] {
  if (field === 'counterparty') return data.counterparties.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }));
  if (field === 'project') return data.projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }));
  return item.type === 'transfer' ? [] : categoryPickerOptions(data.categories[item.type]);
}

const LIST_LABELS: Record<AssignField, string> = { counterparty: 'Контрагенты', category: 'Категории', project: 'Проекты' };

/** «Указать» в пустой ячейке журнала: список с поиском, выбор сохраняется сразу. */
export function AssignPicker(props: { item: JournalItem; field: AssignField; data: AssignData; onPick: (id: number) => void }) {
  const { item, field, data } = props;
  // списки строятся один раз, а не на каждую строку при каждой перерисовке журнала
  const options = useMemo(() => optionsFor(item, field, data), [item.type, field, data]);
  return (
    <SearchPicker
      label="Указать"
      ariaLabel={ASSIGN_LABELS[props.field]}
      listLabel={LIST_LABELS[props.field]}
      options={options}
      onPick={props.onPick}
      // плашка «Указать» (§5.2 этапа 1.5): видна всегда; текст income-strong — контраст 4,7:1 на светло-зелёном
      buttonClassName="rounded-md bg-income-soft px-2 py-0.5 text-xs font-medium text-income-strong hover:brightness-95"
    />
  );
}
