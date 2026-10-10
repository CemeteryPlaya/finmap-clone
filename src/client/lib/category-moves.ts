import type { CategoryNode } from './queries';

/** Тело POST /categories/reorder: новый порядок детей parentId в дереве kind; moving — переносимая сюда категория. */
export interface MovePlan {
  kind: 'income' | 'expense';
  parentId: number | null;
  ids: number[];
  moving: number | null;
}

function findNode(tree: readonly CategoryNode[], id: number): CategoryNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    const child = node.children.find((c) => c.id === id);
    if (child) return child;
  }
  return undefined;
}

/** Почему категорию нельзя вложить в parentId (null — можно). Те же правила, что на сервере (§7). */
export function moveError(tree: readonly CategoryNode[], node: CategoryNode, parentId: number | null): string | null {
  if (parentId === null) return null;
  const parent = tree.find((p) => p.id === parentId);
  if (!parent) return 'Вкладывать можно только в категорию верхнего уровня';
  if (parent.id === node.id) return 'Категорию нельзя вложить в саму себя';
  if (parent.archivedAt) return 'Родительская категория в архиве';
  if (node.systemKey) return 'Системная категория остаётся на верхнем уровне';
  if (node.children.length > 0) return 'Категорию с дочерними нельзя сделать дочерней';
  return null;
}

/** Категория встаёт в список детей parentId перед beforeId (null — в конец). Строка — причина запрета. */
export function planMove(
  tree: readonly CategoryNode[],
  nodeId: number,
  target: { parentId: number | null; beforeId: number | null },
): MovePlan | string {
  const node = findNode(tree, nodeId);
  if (!node) return 'Категория не найдена';
  const err = moveError(tree, node, target.parentId);
  if (err) return err;
  const level = target.parentId === null ? tree : (tree.find((p) => p.id === target.parentId)?.children ?? []);
  const ids = level.map((c) => c.id).filter((id) => id !== nodeId);
  const at = target.beforeId === null ? -1 : ids.indexOf(target.beforeId);
  if (at < 0) ids.push(nodeId);
  else ids.splice(at, 0, nodeId);
  return { kind: node.kind, parentId: target.parentId, ids, moving: nodeId };
}

/** Сдвиг на одну позицию среди соседей; null — двигать некуда. */
export function planShift(tree: readonly CategoryNode[], nodeId: number, delta: -1 | 1): MovePlan | null {
  const node = findNode(tree, nodeId);
  if (!node) return null;
  const level = node.parentId === null ? tree : (findNode(tree, node.parentId)?.children ?? []);
  const ids = level.map((c) => c.id);
  const i = ids.indexOf(nodeId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return { kind: node.kind, parentId: node.parentId, ids, moving: null };
}

/** Куда можно перенести категорию через «Перенести в…»: допустимые родители, кроме текущего. */
export function parentChoices(tree: readonly CategoryNode[], node: CategoryNode): CategoryNode[] {
  return tree.filter((p) => p.id !== node.parentId && moveError(tree, node, p.id) === null);
}
