import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import { DownloadIcon, RefreshIcon } from '../icons';
import { btnSecondary } from '../ui';

const roundButton = 'grid shrink-0 place-items-center rounded-full bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Заголовок страницы отчёта (§2.2 спецификации «Аналитика»): стрелка «назад» к карточкам, заголовок h1 (на него встаёт
 * фокус, когда исчезает кнопка под ним) и подпись. aside — рядом с заголовком на компьютере (вид «график / таблица»);
 * help — «?» у заголовка на телефоне (на компьютере он справа панели).
 */
export function ReportHeader(props: { companyId: number; title: string; subtitle: string; headingRef: Ref<HTMLHeadingElement>; help: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <Link
        to={`/c/${props.companyId}/analytics`}
        aria-label="Назад к отчётам"
        title="Назад к отчётам"
        className="grid size-10 shrink-0 place-items-center rounded-full text-xl hover:bg-field focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true">←</span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 ref={props.headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
            {props.title}
          </h1>
          {props.aside && <div className="ml-2 max-md:hidden">{props.aside}</div>}
          <span className="contents md:hidden">{props.help}</span>
        </div>
        <p className="text-sm text-muted">{props.subtitle}</p>
      </div>
    </div>
  );
}

/** «Обновить» — круглая кнопка: size-8 на панели компьютера, size-11 на телефоне; значок крутится, пока идёт запрос. */
export function RefreshButton(props: { size: string; spinning: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label="Обновить" title="Обновить" onClick={props.onClick} className={`${roundButton} ${props.size}`}>
      <RefreshIcon spinning={props.spinning} />
    </button>
  );
}

/** «Excel» (§2.6): ссылка без побочных эффектов, только значок; имя и подсказка — в aria-label и title. */
export function ExcelLink(props: { size: string; href: string }) {
  return (
    <a href={props.href} download aria-label="Скачать Excel" title="Скачать Excel" className={`${roundButton} ${props.size}`}>
      <DownloadIcon />
    </a>
  );
}

/** До первого ответа — скелет таблицы (§10): серые полосы на месте строк; ошибка — role="alert" и «Повторить». */
export function ReportLoading(props: { error: { message: string } | null; onRetry: () => void }) {
  if (!props.error) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Загрузка…</span>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-field" />
        ))}
      </div>
    );
  }
  return (
    <div className="py-8 text-center">
      <p role="alert" className="mb-4 text-expense-strong">
        {props.error.message}
      </p>
      <button type="button" onClick={props.onRetry} className={btnSecondary}>
        Повторить
      </button>
    </div>
  );
}
