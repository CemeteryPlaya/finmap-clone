import { useState, type ReactNode } from 'react';
import { matchesQuery } from '../../../shared/search';
import { sortedUnique, type JournalUrlState, type OperationType } from '../../lib/journal-filter';
import type { Account, CategoryNode, CategoryTree, Counterparty, Project, Tag } from '../../lib/queries';
import { Modal } from '../Modal';
import { btnPrimary, btnSecondary, inputClass } from '../ui';

export interface FilterDialogData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
}

interface Option {
  id: number;
  label: string;
  /** Отступ дочерней статьи. */
  nested?: boolean;
}

const TYPE_LABELS: Record<OperationType, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };
type ListField = 'accountIds' | 'categoryIds' | 'projectIds' | 'counterpartyIds' | 'tagIds';
type FlagField = 'withoutCategory' | 'withoutProject' | 'withoutCounterparty';

/** Архивные элементы не предлагаются — кроме уже выбранных (например, из адреса): их можно снять. */
function options<T extends { id: number; name: string; archivedAt: string | null }>(rows: T[], selected: readonly number[]): Option[] {
  return rows
    .filter((r) => !r.archivedAt || selected.includes(r.id))
    .map((r) => ({ id: r.id, label: r.archivedAt ? `${r.name} (архив)` : r.name }));
}

function categoryOptions(nodes: CategoryNode[], selected: readonly number[]): Option[] {
  return nodes.flatMap((n) => {
    const children = n.children
      .filter((c) => (!c.archivedAt && !n.archivedAt) || selected.includes(c.id))
      .map((c) => ({ id: c.id, label: c.archivedAt || n.archivedAt ? `${c.name} (архив)` : c.name, nested: true }));
    const self = !n.archivedAt || selected.includes(n.id) ? [{ id: n.id, label: n.archivedAt ? `${n.name} (архив)` : n.name }] : [];
    return [...self, ...children];
  });
}

const sectionClass = 'min-w-0 rounded-2xl bg-field/50 p-3';
const legendClass = 'px-1 text-sm font-semibold';
const checkClass = 'flex items-center gap-2 py-0.5 text-sm';

function CheckList(props: { items: Option[]; selected: readonly number[]; onToggle: (id: number) => void; empty: string }) {
  if (props.items.length === 0) return <p className="py-1 text-sm text-muted">{props.empty}</p>;
  return (
    <div className="max-h-48 overflow-y-auto">
      {props.items.map((o) => (
        <label key={o.id} className={`${checkClass} ${o.nested ? 'pl-5' : ''}`}>
          <input type="checkbox" checked={props.selected.includes(o.id)} onChange={() => props.onToggle(o.id)} />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={sectionClass}>
      <legend className={legendClass}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Модалка «Фильтр» (§7): все условия фильтра журнала §6, кроме периода, поиска и суммы (они в тулбаре).
 * Меняет черновик; «Готово» применяет его, Esc и «Отмена» закрывают без изменений.
 */
function FilterForm(props: { state: JournalUrlState; data: FilterDialogData; onApply: (next: JournalUrlState) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<JournalUrlState>(props.state);
  const [cpQuery, setCpQuery] = useState('');
  const { data } = props;

  const toggle = (field: ListField) => (id: number) =>
    setDraft((d) => ({ ...d, [field]: d[field].includes(id) ? d[field].filter((x) => x !== id) : sortedUnique([...d[field], id]) }));
  const toggleType = (t: OperationType) =>
    setDraft((d) => ({ ...d, types: (['income', 'expense', 'transfer'] as const).filter((x) => (x === t ? !d.types.includes(t) : d.types.includes(x))) }));
  const flag = (field: FlagField, label: string) => (
    <label className={`${checkClass} font-medium`}>
      <input type="checkbox" checked={draft[field]} onChange={() => setDraft((d) => ({ ...d, [field]: !d[field] }))} />
      {label}
    </label>
  );
  const clear = () =>
    setDraft((d) => ({
      ...d,
      types: [],
      accountIds: [],
      categoryIds: [],
      projectIds: [],
      counterpartyIds: [],
      tagIds: [],
      withoutCategory: false,
      withoutProject: false,
      withoutCounterparty: false,
    }));

  const counterparties = options(data.counterparties, draft.counterpartyIds).filter(
    (o) => draft.counterpartyIds.includes(o.id) || matchesQuery(o.label, cpQuery),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(draft);
      }}
    >
      <div className="grid max-h-[60dvh] gap-3 overflow-y-auto md:grid-cols-2">
        <Section legend="Тип операции">
          {(['income', 'expense', 'transfer'] as const).map((t) => (
            <label key={t} className={checkClass}>
              <input type="checkbox" checked={draft.types.includes(t)} onChange={() => toggleType(t)} />
              {TYPE_LABELS[t]}
            </label>
          ))}
        </Section>
        <Section legend="Счета">
          <CheckList items={options(data.accounts, draft.accountIds)} selected={draft.accountIds} onToggle={toggle('accountIds')} empty="Счетов нет" />
        </Section>
        <Section legend="Статьи">
          {flag('withoutCategory', 'Без статьи')}
          <p className="mt-1 text-xs text-muted">Доходы</p>
          <CheckList items={categoryOptions(data.categories.income, draft.categoryIds)} selected={draft.categoryIds} onToggle={toggle('categoryIds')} empty="Статей нет" />
          <p className="mt-1 text-xs text-muted">Расходы</p>
          <CheckList items={categoryOptions(data.categories.expense, draft.categoryIds)} selected={draft.categoryIds} onToggle={toggle('categoryIds')} empty="Статей нет" />
        </Section>
        <Section legend="Проекты">
          {flag('withoutProject', 'Без проекта')}
          <CheckList items={options(data.projects, draft.projectIds)} selected={draft.projectIds} onToggle={toggle('projectIds')} empty="Проектов нет" />
        </Section>
        <Section legend="Контрагенты">
          {flag('withoutCounterparty', 'Без контрагента')}
          <input
            type="search"
            aria-label="Найти контрагента"
            placeholder="Найти контрагента"
            value={cpQuery}
            onChange={(e) => setCpQuery(e.target.value)}
            // Enter в поиске не применяет фильтр
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            className={`${inputClass} my-1 py-1.5 text-sm`}
          />
          <CheckList items={counterparties} selected={draft.counterpartyIds} onToggle={toggle('counterpartyIds')} empty="Никого не нашли" />
        </Section>
        <Section legend="Теги">
          <CheckList items={options(data.tags, draft.tagIds)} selected={draft.tagIds} onToggle={toggle('tagIds')} empty="Тегов нет" />
        </Section>
      </div>
      <p className="mt-3 text-xs text-muted">
        Внутри одного раздела подходит любой из выбранных вариантов («Аренда» или «Без статьи»), между разделами — все условия сразу. Родительская статья включает
        дочерние.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" onClick={clear} className={btnSecondary}>
          Очистить
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: JournalUrlState) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={props.open} title="Фильтр" onClose={props.onClose}>
      <FilterForm
        state={props.state}
        data={props.data}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
        onCancel={props.onClose}
      />
    </Modal>
  );
}
