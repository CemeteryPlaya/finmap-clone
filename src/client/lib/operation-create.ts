import type { CounterpartyType } from '../../shared/system-categories';
import { api } from './api';
import { queryClient } from './query';

/** Что можно создать прямо из формы операции пунктом «+ Создать „…“» (§7). */
export type CreatableKind = 'counterparty' | 'category' | 'project' | 'tag';

/**
 * Создать элемент справочника из формы операции и дождаться обновлённого списка — новый элемент сразу виден
 * в выпадающем списке под своим названием. Возвращает id; ошибка сервера — исключение `ApiError`.
 * Статья — верхнего уровня вида операции, проект — по шаблону «Общий» (без параметров и счетов).
 */
export async function createFromForm(
  companyId: number,
  what: CreatableKind,
  name: string,
  opts: { kind: 'income' | 'expense'; counterpartyType: CounterpartyType },
): Promise<number> {
  const base = `/companies/${companyId}`;
  let id: number;
  switch (what) {
    case 'counterparty':
      id = (await api<{ counterparty: { id: number } }>(`${base}/counterparties`, { method: 'POST', body: { type: opts.counterpartyType, name } })).counterparty.id;
      await queryClient.invalidateQueries({ queryKey: ['counterparties', companyId] });
      break;
    case 'category':
      id = (await api<{ category: { id: number } }>(`${base}/categories`, { method: 'POST', body: { kind: opts.kind, name, parentId: null } })).category.id;
      await queryClient.invalidateQueries({ queryKey: ['categories', companyId] });
      break;
    case 'project':
      id = (await api<{ project: { id: number } }>(`${base}/projects`, { method: 'POST', body: { name, templateKey: 'general' } })).project.id;
      await queryClient.invalidateQueries({ queryKey: ['projects', companyId] });
      break;
    case 'tag':
      id = (await api<{ tag: { id: number } }>(`${base}/tags`, { method: 'POST', body: { name } })).tag.id;
      await queryClient.invalidateQueries({ queryKey: ['tags', companyId] });
      break;
  }
  return id;
}
