import { useQuery } from '@tanstack/react-query';
import type { SenetHistoryCheck, SenetMatchMode, SenetRuleDto, SenetRuleType } from '../../shared/schemas/senet';
import { api, type ApiError } from './api';

/** Правила разноски компании (§8.1). */
export function useSenetRules(companyId: number) {
  return useQuery<SenetRuleDto[], ApiError>({
    queryKey: ['senet', companyId, 'rules'],
    queryFn: async () => (await api<{ rules: SenetRuleDto[] }>(`/companies/${companyId}/senet/rules`)).rules,
  });
}

export const MATCH_LABELS: Record<SenetMatchMode, string> = { word: 'слово', first: 'первое слово', phrase: 'фраза целиком', prefix: 'начинается с', contains: 'содержит' };

export type RuleField = 'category' | 'counterparty' | 'comment' | 'mistaken' | 'defect';

/** Часть секции — один тип правила: какие поля у строк, какие настройки у типа (строка с пустым шаблоном). */
export interface RulePart {
  type: SenetRuleType;
  label: string;
  hint?: string;
  fields: RuleField[];
  defaultMatch: SenetMatchMode;
  /** Настройка типа: категория и (или) контрагент для всех слов типа. */
  setting?: { category?: string; counterparty?: string };
  /** Порядок важен: срабатывает первое подходящее правило. */
  ordered?: boolean;
}

export const RULE_SECTIONS: { key: string; title: string; parts: RulePart[] }[] = [
  {
    key: 'employees',
    title: 'Сотрудники: алиасы',
    parts: [
      {
        type: 'employee_alias',
        label: 'Алиас → сотрудник',
        hint: 'Как кассиры пишут имя: латиницей и кириллицей. «Ошибочный» — имя владельца, которым в ЗП называют сотрудника',
        fields: ['counterparty', 'mistaken'],
        defaultMatch: 'word',
      },
    ],
  },
  {
    key: 'salary',
    title: 'Слова зарплаты, доплаты, стажёра',
    parts: [
      { type: 'salary_word', label: 'Признаки зарплаты', fields: [], defaultMatch: 'word', setting: { category: 'Категория зарплаты' } },
      { type: 'extra_pay_word', label: 'Доплата («dop zp» — первому получателю ЗП смены)', fields: [], defaultMatch: 'word' },
      { type: 'trainee', label: 'Стажёр (ЗП без контрагента, комментарий «стажер»)', fields: [], defaultMatch: 'contains' },
    ],
  },
  { key: 'kaspi', title: 'Каспи', parts: [{ type: 'kaspi', label: 'Вынос — оплата через Kaspi POS, доход «Каспи»', fields: [], defaultMatch: 'phrase' }] },
  { key: 'masters', title: 'Мастера', parts: [{ type: 'master', label: 'Алиас → мастер и категория', fields: ['category', 'counterparty'], defaultMatch: 'word' }] },
  {
    key: 'owners',
    title: 'Владельцы и семья',
    parts: [
      { type: 'owner_a_alias', label: 'Алиасы владельца А', hint: 'Только эти имена — «Дивиденды», владелец А', fields: [], defaultMatch: 'word', setting: { counterparty: 'Владелец А' } },
      {
        type: 'owner_word',
        label: 'Другие имена владельцев и семьи',
        hint: 'Любое другое имя или несколько имён — «Дивиденды», владелец Б. Новых владельцев разноска не создаёт',
        fields: [],
        defaultMatch: 'word',
        setting: { category: 'Категория дивидендов', counterparty: 'Владелец Б' },
      },
    ],
  },
  { key: 'lunch', title: 'Обед', parts: [{ type: 'lunch', label: 'Слова обеда', fields: [], defaultMatch: 'first', setting: { category: 'Категория обеда' } }] },
  {
    key: 'keywords',
    title: 'Ключевые слова',
    parts: [{ type: 'keyword', label: 'Слово → категория', hint: 'Срабатывает первое подходящее — порядок меняется кнопками', fields: ['category', 'counterparty', 'comment'], defaultMatch: 'contains', ordered: true }],
  },
  {
    key: 'bar',
    title: 'Бар',
    parts: [
      { type: 'bar_item', label: 'Товары бара (и «кол-во x цена»)', fields: ['defect'], defaultMatch: 'contains', setting: { category: 'Категория бара' } },
      { type: 'bar_supplier', label: 'Слово товара → поставщик', fields: ['counterparty'], defaultMatch: 'contains', setting: { counterparty: 'Поставщик по умолчанию' } },
    ],
  },
  { key: 'exact', title: 'Точные правила', parts: [{ type: 'exact', label: 'Комментарий целиком → категория', fields: ['category', 'counterparty', 'comment'], defaultMatch: 'phrase' }] },
];

/** Сдвиг правила на одну позицию: dir −1 — выше, +1 — ниже; у края — без изменений. */
export function moveId(ids: readonly number[], id: number, dir: -1 | 1): number[] {
  const out = [...ids];
  const i = out.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Строка правила в списке. */
export function ruleSummary(
  r: Pick<SenetRuleDto, 'pattern' | 'match' | 'categoryId' | 'counterpartyId' | 'officeId' | 'commentTemplate' | 'flags'>,
  names: { category: (id: number) => string; counterparty: (id: number) => string; office: (id: number) => string },
): string {
  const target = [r.categoryId !== null ? names.category(r.categoryId) : null, r.counterpartyId !== null ? names.counterparty(r.counterpartyId) : null].filter(Boolean).join(', ');
  const parts = [`«${r.pattern}» · ${MATCH_LABELS[r.match]}${target ? ` → ${target}` : ''}`];
  if (r.officeId !== null) parts.push(`только ${names.office(r.officeId)}`);
  if (r.flags.mistaken) parts.push('ошибочный алиас');
  if (r.flags.defect) parts.push('брак');
  if (r.commentTemplate) parts.push(r.commentTemplate === '{orig}' ? 'комментарий — исходный текст' : `комментарий «${r.commentTemplate}»`);
  return parts.join(' · ');
}

export function historySummary(r: SenetHistoryCheck): string {
  if (r.total === 0) return 'Выемок за период нет';
  const head = `Распознано ${r.recognized} из ${r.total}`;
  return r.differs.length ? `${head} · иначе, чем в журнале: ${r.differs.length}` : head;
}
