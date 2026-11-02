import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SENET_MATCH_MODES, type SenetConnectionDto, type SenetMatchMode, type SenetRuleDto, type SenetRuleInput } from '../../../shared/schemas/senet';
import { api, type ApiError } from '../../lib/api';
import { useCategories, useCounterparties, type CategoryNode } from '../../lib/queries';
import { invalidateSenet } from '../../lib/senet';
import { MATCH_LABELS, moveId, RULE_SECTIONS, ruleSummary, useSenetRules, type RulePart } from '../../lib/senet-rules';
import { Pending } from '../QueryState';
import { alertClass, btnIcon, btnSmall, inputClass } from '../ui';
import { HistoryCheck } from './HistoryCheck';

type Option = { id: number; label: string };
const flat = (nodes: CategoryNode[], depth = 0): Option[] =>
  nodes.filter((n) => !n.archivedAt).flatMap((n) => [{ id: n.id, label: `${'— '.repeat(depth)}${n.name}` }, ...flat(n.children, depth + 1)]);

function Select(props: { label: string; value: number | null; options: Option[]; onChange: (id: number | null) => void; disabled?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{props.label}</span>
      <select value={props.value ?? ''} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
        <option value="">—</option>
        {props.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const empty = (part: RulePart): SenetRuleInput => ({ type: part.type, pattern: '', match: part.defaultMatch, officeId: null, categoryId: null, counterpartyId: null, commentTemplate: null, flags: {} });

/** Одна часть секции: настройка типа, список правил с порядком и архивом, форма нового правила. */
function PartEditor(props: { companyId: number; part: RulePart; rules: SenetRuleDto[]; categories: Option[]; counterparties: Option[]; offices: Option[]; readOnly: boolean }) {
  const { part } = props;
  const base = `/companies/${props.companyId}/senet/rules`;
  const [draft, setDraft] = useState<SenetRuleInput>(empty(part));
  const [editing, setEditing] = useState<number | null>(null);
  const act = useMutation<unknown, ApiError, { url: string; method: 'POST' | 'PATCH' | 'DELETE' | 'PUT'; body?: unknown }>({
    mutationFn: (x) => api(x.url, { method: x.method, body: x.body }),
    onSuccess: async () => {
      await invalidateSenet(props.companyId);
      setDraft(empty(part));
      setEditing(null);
    },
  });
  const words = props.rules.filter((r) => r.pattern !== '' && !r.archived);
  const setting = props.rules.find((r) => r.pattern === '' && !r.archived) ?? null;
  const name = (list: Option[]) => (id: number) => list.find((o) => o.id === id)?.label.replace(/^(— )+/, '') ?? 'не найдено';
  const names = { category: name(props.categories), counterparty: name(props.counterparties), office: name(props.offices) };
  const saveSetting = (patch: Partial<SenetRuleInput>) => {
    const body = { ...(setting ?? empty(part)), pattern: '', ...patch };
    act.mutate(setting ? { url: `${base}/${setting.id}`, method: 'PATCH', body } : { url: base, method: 'POST', body });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.mutate(editing ? { url: `${base}/${editing}`, method: 'PATCH', body: draft } : { url: base, method: 'POST', body: draft });
  };
  const has = (f: string) => part.fields.includes(f as never);

  return (
    <div className="mt-3 rounded-xl bg-field/40 p-3">
      <h4 className="font-semibold">{part.label}</h4>
      {part.hint && <p className="text-sm text-muted">{part.hint}</p>}
      {part.setting && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {part.setting.category && (
            <Select label={part.setting.category} value={setting?.categoryId ?? null} options={props.categories} disabled={props.readOnly || act.isPending} onChange={(id) => saveSetting({ categoryId: id })} />
          )}
          {part.setting.counterparty && (
            <Select label={part.setting.counterparty} value={setting?.counterpartyId ?? null} options={props.counterparties} disabled={props.readOnly || act.isPending} onChange={(id) => saveSetting({ counterpartyId: id })} />
          )}
        </div>
      )}
      <ul className="mt-2 grid gap-1">
        {words.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-field py-1.5 text-sm">
            <span>
              {ruleSummary(r, names)}
              {r.createdFromReview && <span className="ml-2 text-muted">из очереди</span>}
            </span>
            {!props.readOnly && (
              <span className="flex gap-1">
                {part.ordered && (
                  <>
                    <button type="button" className={btnIcon} aria-label="Выше" disabled={i === 0 || act.isPending} onClick={() => act.mutate({ url: `${base}/order`, method: 'PUT', body: { type: part.type, ids: moveId(words.map((x) => x.id), r.id, -1) } })}>
                      ↑
                    </button>
                    <button type="button" className={btnIcon} aria-label="Ниже" disabled={i === words.length - 1 || act.isPending} onClick={() => act.mutate({ url: `${base}/order`, method: 'PUT', body: { type: part.type, ids: moveId(words.map((x) => x.id), r.id, 1) } })}>
                      ↓
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={btnSmall}
                  onClick={() => {
                    setEditing(r.id);
                    setDraft({ type: r.type, pattern: r.pattern, match: r.match, officeId: r.officeId, categoryId: r.categoryId, counterpartyId: r.counterpartyId, commentTemplate: r.commentTemplate, flags: r.flags });
                  }}
                >
                  Изменить
                </button>
                <button type="button" className={btnSmall} disabled={act.isPending} onClick={() => act.mutate({ url: `${base}/${r.id}`, method: 'DELETE' })}>
                  В архив
                </button>
              </span>
            )}
          </li>
        ))}
        {words.length === 0 && <li className="text-sm text-muted">Слов пока нет.</li>}
      </ul>
      {!props.readOnly && (
        <form noValidate onSubmit={submit} className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{editing ? 'Слово или фраза (правка)' : 'Новое слово или фраза'}</span>
            <input value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Совпадение</span>
            <select value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as SenetMatchMode })} className={inputClass}>
              {SENET_MATCH_MODES.map((m) => (
                <option key={m} value={m}>
                  {MATCH_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <Select label="Только для клуба" value={draft.officeId} options={props.offices} onChange={(id) => setDraft({ ...draft, officeId: id })} />
          {has('category') && <Select label="Категория" value={draft.categoryId} options={props.categories} onChange={(id) => setDraft({ ...draft, categoryId: id })} />}
          {has('counterparty') && <Select label="Контрагент" value={draft.counterpartyId} options={props.counterparties} onChange={(id) => setDraft({ ...draft, counterpartyId: id })} />}
          {has('comment') && (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Комментарий операции ({'{orig}'} — исходный текст)</span>
              <input value={draft.commentTemplate ?? ''} onChange={(e) => setDraft({ ...draft, commentTemplate: e.target.value || null })} className={inputClass} />
            </label>
          )}
          {has('mistaken') && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.flags.mistaken ?? false} onChange={(e) => setDraft({ ...draft, flags: { ...draft.flags, mistaken: e.target.checked } })} />
              Ошибочный алиас
            </label>
          )}
          {has('defect') && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.flags.defect ?? false} onChange={(e) => setDraft({ ...draft, flags: { ...draft.flags, defect: e.target.checked } })} />
              Брак (исходный текст — в комментарий)
            </label>
          )}
          <div className="flex items-end gap-2">
            <button type="submit" className={btnSmall} disabled={act.isPending || !draft.pattern.trim()}>
              {editing ? 'Сохранить' : 'Добавить'}
            </button>
            {editing && (
              <button type="button" className={btnSmall} onClick={() => (setEditing(null), setDraft(empty(part)))}>
                Отмена
              </button>
            )}
          </div>
        </form>
      )}
      {act.error && (
        <p role="alert" className={`${alertClass} mt-2 mb-0`}>
          {act.error.fields?.pattern ?? act.error.fields?.categoryId ?? act.error.message}
        </p>
      )}
    </div>
  );
}

/** «Правила разноски» (§8.1): секции по типам §4.3 и «Проверить на истории». */
export function RulesTab(props: { companyId: number; connections: SenetConnectionDto[]; timeZone: string; readOnly: boolean }) {
  const rules = useSenetRules(props.companyId);
  const categories = useCategories(props.companyId);
  const counterparties = useCounterparties(props.companyId);
  if (!rules.data || !categories.data || !counterparties.data) return <Pending queries={[rules, categories, counterparties]} />;
  const cats = flat(categories.data.expense);
  const cps = counterparties.data.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }));
  const offices = props.connections.flatMap((c) => c.offices.map((o) => ({ id: o.id, label: o.name || `Клуб ${o.senetOfficeId}` })));
  return (
    <div>
      <HistoryCheck companyId={props.companyId} offices={offices} timeZone={props.timeZone} />
      {RULE_SECTIONS.map((s) => (
        <section key={s.key} className="mt-6">
          <h3 className="text-lg font-bold">{s.title}</h3>
          {s.parts.map((p) => (
            <PartEditor key={p.type} companyId={props.companyId} part={p} rules={rules.data.filter((r) => r.type === p.type)} categories={cats} counterparties={cps} offices={offices} readOnly={props.readOnly} />
          ))}
        </section>
      ))}
    </div>
  );
}
