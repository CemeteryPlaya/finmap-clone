import { useQuery } from '@tanstack/react-query';
import type { StockDocType, WriteoffReason } from '../../shared/schemas/stock';
import type { StockUnit } from '../../shared/stock-qty';
import type { PricePoint } from '../../shared/stock-price';
import { api, type ApiError } from './api';
import { queryClient } from './query';

/** Остатки и стоимость недорогие: обновляются при возврате на вкладку, не чаще раза в 30 с. */
const REFRESH_ON_FOCUS = { refetchOnWindowFocus: true, staleTime: 30_000 } as const;

export interface StockGroup {
  id: number;
  companyId: number;
  name: string;
  orderIndex: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface StockItem {
  id: number;
  companyId: number;
  name: string;
  groupId: number | null;
  unit: StockUnit;
  barcode: string | null;
  isCombo: boolean;
  /** Текущая цена продажи за единицу, минимальные единицы валюты. */
  salePrice: number;
  /** Минимальный остаток, тысячные доли единицы. */
  minQty: number | null;
  createdAt: string;
  archivedAt: string | null;
  prices: PricePoint[];
}

export interface StockWarehouse {
  id: number;
  companyId: number;
  projectId: number;
  name: string;
  receiptsSource: 'manual' | 'senet';
  createdAt: string;
  archivedAt: string | null;
}

export interface StockDocLine {
  id: number;
  position: number;
  itemId: number;
  qty: number;
  amount: number | null;
  /** Себестоимость строки продажи или списания; null — у поступления и у строки без партии. */
  cost: number | null;
  /** Сколько из строки не нашло партии («Нет партии»). */
  uncovered: number;
}

export interface DocPayment {
  operationId: number;
  amount: number;
  paidAt: string;
}

export interface StockDocListItem {
  id: number;
  type: StockDocType;
  number: string;
  at: string;
  warehouseId: number;
  counterpartyId: number | null;
  reason: WriteoffReason | null;
  comment: string | null;
  version: number;
  total: number;
  linesCount: number;
  paid: number;
  posted: boolean;
}

export interface StockDoc extends StockDocListItem {
  lines: StockDocLine[];
  payments: DocPayment[];
  posting: { operationId: number; amount: number } | null;
  lastPost: { accountId: number; categoryId: number | null } | null;
  deletedAt: string | null;
}

/** Чем документ меняет чужие проведённые документы (§5.4 спецификации «Склад»). */
export interface DocImpact {
  sales: number;
  writeoffs: number;
  /** ISO-момент правки; null — чужие документы не затронуты. */
  since: string | null;
}

export interface BalanceBatch {
  lineId: number;
  docId: number;
  docNumber: string;
  warehouseId: number;
  counterpartyId: number | null;
  at: string;
  qtyIn: number;
  costIn: number;
  qtyLeft: number;
  costLeft: number;
}

export interface BalanceItem {
  itemId: number;
  qty: number;
  qtyLeft: number;
  deficit: number;
  /** Момент самой ранней продажи или списания без партии; null — долга нет (ответ 1a). */
  deficitAt: string | null;
  cost: number;
  avgCost: number | null;
  salePrice: number;
  markupBp: number | null;
  low: boolean;
  batches: BalanceBatch[];
}

export interface StockBalance {
  warehouseId: number | null;
  at: string | null;
  items: BalanceItem[];
  total: number;
}

export interface WarehouseValue {
  warehouseId: number;
  projectId: number;
  name: string;
  value: number;
  /** На складе есть продажи или списания без партии (ответ 1a). */
  hasDeficit: boolean;
}

export interface StockValue {
  warehouses: WarehouseValue[];
  total: number;
}

export interface UnpaidDoc {
  docId: number;
  number: string;
  at: string;
  total: number;
  paid: number;
  own: number;
  debt: number;
}

export interface Unpaid {
  docs: UnpaidDoc[];
  lastCategoryId: number | null;
}

const base = (companyId: number) => `/companies/${companyId}/stock`;

export function useStockGroups(companyId: number) {
  return useQuery<StockGroup[], ApiError>({
    queryKey: ['stock', companyId, 'groups'],
    queryFn: async () => (await api<{ groups: StockGroup[] }>(`${base(companyId)}/groups`)).groups,
  });
}

export function useStockItems(companyId: number) {
  return useQuery<StockItem[], ApiError>({
    queryKey: ['stock', companyId, 'items'],
    queryFn: async () => (await api<{ items: StockItem[] }>(`${base(companyId)}/items`)).items,
  });
}

export function useStockWarehouses(companyId: number) {
  return useQuery<StockWarehouse[], ApiError>({
    queryKey: ['stock', companyId, 'warehouses'],
    queryFn: async () => (await api<{ warehouses: StockWarehouse[] }>(`${base(companyId)}/warehouses`)).warehouses,
  });
}

/** Остатки на сейчас; warehouse — склад или все. Ключ ['stock', cid, 'balance', …]: сброс ['stock', cid] обновляет и их. */
export function useStockBalance(companyId: number, warehouse: number | null, enabled = true) {
  return useQuery<StockBalance, ApiError>({
    queryKey: ['stock', companyId, 'balance', warehouse],
    queryFn: () => api<StockBalance>(`${base(companyId)}/balance${warehouse === null ? '' : `?warehouse=${warehouse}`}`),
    enabled,
    ...REFRESH_ON_FOCUS,
  });
}

/** Стоимость складов для левой панели (§4.4). */
export function useStockValue(companyId: number) {
  return useQuery<StockValue, ApiError>({
    queryKey: ['stock', companyId, 'value'],
    queryFn: () => api<StockValue>(`${base(companyId)}/value`),
    ...REFRESH_ON_FOCUS,
  });
}

export interface DocsQuery {
  type: StockDocType | null;
  warehouse: number | null;
  limit: number;
}

export function docsQueryString(q: DocsQuery): string {
  const p = new URLSearchParams();
  if (q.type) p.set('type', q.type);
  if (q.warehouse !== null) p.set('warehouse', String(q.warehouse));
  p.set('limit', String(q.limit));
  return p.toString();
}

export function useStockDocs(companyId: number, q: DocsQuery) {
  return useQuery<{ docs: StockDocListItem[]; hasMore: boolean }, ApiError>({
    queryKey: ['stock', companyId, 'docs', docsQueryString(q)],
    queryFn: () => api<{ docs: StockDocListItem[]; hasMore: boolean }>(`${base(companyId)}/docs?${docsQueryString(q)}`),
    // при смене фильтра прежний список остаётся на экране до ответа
    placeholderData: (prev) => prev,
  });
}

export function useStockDoc(companyId: number, id: number | null) {
  return useQuery<StockDoc, ApiError>({
    queryKey: ['stock', companyId, 'doc', id],
    queryFn: async () => (await api<{ doc: StockDoc }>(`${base(companyId)}/docs/${id}`)).doc,
    enabled: id !== null,
    gcTime: 0,
  });
}

/** Поступления поставщика с долгом; operationId — расход, который правят (его оплаты остаются в списке). */
export function useUnpaid(companyId: number, supplierId: number | null, operationId: number | null) {
  return useQuery<Unpaid, ApiError>({
    queryKey: ['stock', companyId, 'unpaid', supplierId, operationId],
    queryFn: () => api<Unpaid>(`${base(companyId)}/suppliers/${supplierId}/unpaid${operationId === null ? '' : `?operationId=${operationId}`}`),
    enabled: supplierId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/** После любого изменения склада: каталог, документы, остатки, стоимость и долги по закупкам. */
export function invalidateStock(companyId: number): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['stock', companyId] });
}
