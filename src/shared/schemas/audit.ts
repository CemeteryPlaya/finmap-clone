import { z } from 'zod';

const id = z.number().int().positive();

/** Больше действий одна отмена не отменяет (план 2026-10-20, R14). */
export const UNDO_CASCADE_MAX = 1000;

/** «Отменить действия»: id записей каскада, которые человек видел в окне подтверждения. */
export const auditUndoSchema = z.object({
  ids: z.array(id).min(1, 'Нет действий для отмены').max(UNDO_CASCADE_MAX, `Не больше ${UNDO_CASCADE_MAX} действий`),
});

export type UndoableAction = 'create' | 'update' | 'delete' | 'restore';
export type UndoOperationType = 'income' | 'expense' | 'transfer';

/** Действие каскада в окне подтверждения отмены. */
export interface UndoPreviewEntry {
  id: number;
  action: UndoableAction;
  type: UndoOperationType | null;
  at: string;
  userName: string | null;
}

export interface UndoPreview {
  entries: UndoPreviewEntry[];
}

/** Отменённое действие в diff записи «Отмена» (R10): тип — из записи, которую отменили. */
export interface UndoneAction {
  id: number;
  action: UndoableAction;
  type: UndoOperationType | null;
}

export interface UndoResult {
  /** id отменённых записей, от новой к старой. */
  undone: number[];
  /** id записи «Отмена». */
  undoId: number;
  operation: { id: number; deleted: boolean };
}
