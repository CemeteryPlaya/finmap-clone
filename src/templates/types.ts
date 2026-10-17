import type { z } from 'zod';
import type { SystemKey } from '../shared/system-categories';

export interface CategoryLeaf {
  ref: string;
  name: string;
}

export interface CategoryGroup {
  ref: string;
  name: string;
  children?: CategoryLeaf[];
}

export interface UnderSystemGroup {
  underSystem: SystemKey;
  children: CategoryLeaf[];
}

export type CategoryNode = CategoryGroup | UnderSystemGroup;

export interface ParamUi {
  key: string;
  label: string;
  type: 'int' | 'text';
  hint?: string;
}

export interface MetricDef {
  key: string;
  label: string;
  unit: 'money' | 'percent';
}

export interface BusinessTemplate {
  key: string;
  name: string;
  params: z.ZodType<Record<string, unknown>>;
  paramsUi: ParamUi[];
  categories: { income: CategoryNode[]; expense: CategoryNode[] };
  defaultAccounts: { name: string; currency?: string }[];
  integrations: string[];
  metrics: MetricDef[];
  /**
   * Умолчания «Финансовых показателей» (§8.2 спецификации «Аналитика»): ссылки категорий шаблона (`templateRef`) для частей
   * «Себестоимость» и «Переменные расходы». Пока часть не настроена, в неё входят категории компании с этими ссылками.
   */
  indicatorDefaults?: { cogs: readonly string[]; variable: readonly string[] };
}

export function isUnderSystem(node: CategoryNode): node is UnderSystemGroup {
  return 'underSystem' in node;
}
