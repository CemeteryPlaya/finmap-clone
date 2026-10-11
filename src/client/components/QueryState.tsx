import { LoadError } from './LoadError';

interface QueryLike {
  data: unknown;
  error: { message: string } | null;
  refetch: () => unknown;
}

/** Пока каких-то данных нет: ошибка с «Повторить» или «Загрузка…». */
export function Pending({ queries }: { queries: QueryLike[] }) {
  const failed = queries.find((q) => q.data === undefined && q.error);
  if (failed?.error) return <LoadError message={failed.error.message} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  return <div className="text-muted">Загрузка…</div>;
}

/** Данные уже показаны, а фоновое обновление не удалось: плашка над ними, данные остаются на экране. */
export function StaleNotice({ queries }: { queries: QueryLike[] }) {
  const failed = queries.find((q) => q.error);
  if (!failed?.error) return null;
  return (
    <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense-strong">
      <span>Не удалось обновить данные: {failed.error.message}</span>
      <button type="button" onClick={() => queries.forEach((q) => void q.refetch())} className="font-semibold underline">
        Повторить
      </button>
    </p>
  );
}
