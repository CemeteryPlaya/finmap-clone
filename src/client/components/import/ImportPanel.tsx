import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AccountMapping, ImportCommitResult, ImportPreview } from '../../../shared/schemas/imports';
import { ApiError } from '../../lib/api';
import { formatFileSize, isFileDrag } from '../../lib/attachments';
import {
  blockReason,
  checkStatus,
  commitImport,
  doneText,
  IMPORT_ACCEPT,
  IMPORT_TEMPLATE_HREF,
  importSizeError,
  invalidateAfterImport,
  isImportPreview,
  needsRemembered,
  previewImport,
  PREVIEW_DEBOUNCE_MS,
  requestMappings,
  sameMapping,
  uploadImport,
} from '../../lib/import-panel';
import { queryClient } from '../../lib/query';
import { useAccounts, type Company } from '../../lib/queries';
import { Drawer } from '../Drawer';
import { DownloadIcon, FolderIcon } from '../icons';
import { alertClass, btnPrimary, btnSecondary } from '../ui';
import { ImportPreviewView } from './ImportPreviewView';

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'fileError'; message: string }
  | { kind: 'preview'; preview: ImportPreview }
  | { kind: 'done'; result: ImportCommitResult };

/** 410 (кэш вытеснен, сервер перезапущен): файл проверяется заново сам (§5.6). */
const EXPIRED_NOTICE = 'Проверка устарела — файл проверен заново. Проверьте итог и нажмите «Импортировать» ещё раз';

/** Текст ошибки запроса: у файла — сообщение F* или «Нет файла», остальное — сообщение сервера. */
function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  return e.fields?.file ?? e.message;
}

const expired = (e: unknown) => e instanceof ApiError && e.code === 'IMPORT_EXPIRED';

const OpenImportContext = createContext<(() => void) | null>(null);

/** Открыть панель импорта; null — импорт недоступен (архивная компания) или вне раскладки компании. */
export function useOpenImport(): (() => void) | null {
  return useContext(OpenImportContext);
}

/**
 * Одна панель импорта на компанию — в раскладке компании (CompanyLayout), а не в журнале или нижней панели: переход
 * по истории браузера, смена ширины окна или скрытие нижней панели не размонтируют её, пока идёт запись (решение 18
 * плана И-2). Открывают её «Импортировать» в тулбаре журнала и «Импорт из Excel» в «Ещё» на телефоне.
 * Панель привязана к компании, в которой её открыли (R1 плана И-2): все запросы — к ней, её название — под заголовком.
 * Компания в адресе сменилась (история браузера), а записи нет — панель закрывается, файл, выбор счетов и проверка
 * сбрасываются; идёт запись — панель остаётся с прежней компанией до конца записи и закрывается по «Готово».
 */
export function ImportPanelHost({ company, children }: { company: Company; children: ReactNode }) {
  /** Компания, в которой панель открыта; null — панель закрыта. */
  const [bound, setBound] = useState<Company | null>(null);
  const busy = useRef(false);
  const show = useCallback(() => setBound(company), [company]);
  useEffect(() => {
    setBound((b) => (b !== null && b.id !== company.id && !busy.current ? null : b));
  }, [company.id]);
  // в архивную компанию импорт запрещён (§1.2 спецификации импорта): ни кнопки, ни пункта, ни панели
  const canImport = company.archivedAt === null;
  // та же компания — свежие данные из адреса (название после переименования); другая — та, где панель открыли
  const target = bound === null || bound.id === company.id ? company : bound;
  return (
    <OpenImportContext.Provider value={canImport ? show : null}>
      {children}
      {(canImport || bound !== null) && (
        <ImportPanel company={target} open={bound !== null} onClose={() => setBound(null)} onBusy={(b) => (busy.current = b)} />
      )}
    </OpenImportContext.Provider>
  );
}

/**
 * Правая панель «Импорт из Excel» (§5 спецификации импорта). 480 px на компьютере, на телефоне — на весь экран; пока
 * идёт запись, панель не закрывается (Drawer.busy). Содержимое (и состояние) монтируется заново при каждом открытии;
 * подвал с «Импортировать» — в закреплённом низу панели (портал в слот `footer`).
 */
export function ImportPanel({
  company,
  open,
  onClose,
  onBusy,
}: {
  company: Company;
  open: boolean;
  onClose: () => void;
  /** Идёт запись: ImportPanelHost не закрывает панель при смене компании (R1). */
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const changeBusy = (b: boolean) => {
    setBusy(b);
    onBusy?.(b);
  };
  return (
    <Drawer
      open={open}
      side="right"
      wide
      title="Импорт из Excel"
      subtitle={company.name}
      onClose={onClose}
      busy={busy}
      footer={<div ref={setFooter} />}
    >
      <ImportFlow company={company} footer={footer} onBusy={changeBusy} onDone={onClose} />
    </Drawer>
  );
}

function ImportFlow(props: { company: Company; footer: HTMLDivElement | null; onBusy: (busy: boolean) => void; onDone: () => void }) {
  const cid = props.company.id;
  const accounts = useAccounts(cid);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  /** Карточки с неверной суммой: ключ → название из файла. */
  const [invalid, setInvalid] = useState<ReadonlyMap<string, string>>(new Map());
  /** Выбор человека по ключу счёта: переживает «Выбрать другой файл» (§5.4). */
  const choices = useRef(new Map<string, AccountMapping>());
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Номер последнего запроса предпросмотра: ответ устаревшего не показывается. */
  const seq = useRef(0);
  const [focusTarget, setFocusTarget] = useState<{ n: number; to: 'heading' | 'done' } | null>(null);
  const reasonId = useId();
  const hintId = useId();
  const preview = phase.kind === 'preview' ? phase.preview : null;

  // панель закрыта (или сменилась компания, R1): пересчёт не запускается, ответы начатых запросов не показываются
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      seq.current++;
    },
    [],
  );
  useEffect(() => {
    if (!focusTarget) return;
    (focusTarget.to === 'heading' ? headingRef : doneRef).current?.focus();
  }, [focusTarget]);

  const show = (p: ImportPreview, focus: boolean) => {
    // выбор человека, которого в свежей проверке уже нет (сервер прислал другое сопоставление), — забыт: карточка
    // показывает сопоставление сервера, и запрос уйдёт с ним же
    for (const card of p.accounts) {
      const mine = choices.current.get(card.key);
      if (mine && !sameMapping(mine, card.mapping)) choices.current.delete(card.key);
    }
    setPhase({ kind: 'preview', preview: p });
    setStatus(checkStatus(p));
    if (focus) setFocusTarget((f) => ({ n: (f?.n ?? 0) + 1, to: 'heading' }));
  };

  /** Загрузка и проверка; выбор счетов из прошлого файла применяется сразу (§5.4). */
  const check = async (f: File, after?: string) => {
    const n = ++seq.current;
    clearTimeout(timer.current);
    setRefreshing(false);
    setPhase({ kind: 'checking' });
    setStatus('Проверяем файл…');
    try {
      let p = await uploadImport(cid, f);
      if (n !== seq.current) return;
      if (after || needsRemembered(p, choices.current)) p = await previewImport(cid, p.token, requestMappings(p, choices.current));
      if (n !== seq.current) return;
      show(p, true);
      setNotice(after ?? null);
    } catch (e) {
      if (n !== seq.current) return;
      const message = errorText(e);
      setPhase({ kind: 'fileError', message });
      setStatus(message);
    }
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    const tooBig = importSizeError(f.size);
    setNotice(null);
    setInvalid(new Map());
    if (tooBig) {
      // файл не загружается: прежний выбор остаётся
      setSizeError(tooBig);
      setStatus(tooBig);
      return;
    }
    setSizeError(null);
    setFile(f);
    void check(f);
  };

  /** Пересчёт по кэшу с текущим сопоставлением (n — номер правки); 410 — файл проверяется заново. */
  const refresh = async (base: ImportPreview, n: number) => {
    try {
      const p = await previewImport(cid, base.token, requestMappings(base, choices.current));
      if (n !== seq.current) return;
      show(p, false);
      setRefreshing(false);
    } catch (e) {
      if (n !== seq.current) return;
      setRefreshing(false);
      if (expired(e) && file) void check(file, EXPIRED_NOTICE);
      else setNotice(errorText(e));
    }
  };

  const onCardChange = (key: string, mapping: AccountMapping | null, error: string | null) => {
    setNotice(null);
    setInvalid((prev) => {
      const next = new Map(prev);
      if (error) next.set(key, preview?.accounts.find((a) => a.key === key)?.fileName ?? key);
      else next.delete(key);
      return next;
    });
    if (mapping) choices.current.set(key, mapping);
    else choices.current.delete(key);
    clearTimeout(timer.current);
    // номер — с момента правки: ответ более раннего пересчёта уже устарел и не показывается
    const n = ++seq.current;
    if (error || !preview) {
      setRefreshing(false);
      return;
    }
    // до ответа «Импортировать» недоступна (§5.3)
    setRefreshing(true);
    const base = preview;
    timer.current = setTimeout(() => void refresh(base, n), PREVIEW_DEBOUNCE_MS);
  };

  const reason = preview ? blockReason(preview, { refreshing, invalidCards: [...invalid.values()] }) : null;

  const commit = async () => {
    if (!preview || reason || committing) return;
    setCommitting(true);
    props.onBusy(true);
    setNotice(null);
    setStatus('Импортируем…');
    try {
      const result = await commitImport(cid, preview, requestMappings(preview, choices.current));
      setPhase({ kind: 'done', result });
      setStatus(doneText(result));
      setFocusTarget((f) => ({ n: (f?.n ?? 0) + 1, to: 'done' }));
      void invalidateAfterImport(cid);
    } catch (e) {
      const fresh = e instanceof ApiError ? e.details?.preview : undefined;
      if (e instanceof ApiError && (e.code === 'IMPORT_CHANGED' || e.code === 'IMPORT_INVALID') && isImportPreview(fresh)) {
        // за время проверки данные изменились (409) или импорт стал невозможен — ошибки или «Нечего импортировать» (422):
        // свежий предпросмотр, выбор человека там, где карточки совпали, и новое нажатие (§5.6). Счета могли
        // появиться — список для карточек обновляется («Создать новый счёт» с тем же названием недоступен, R4)
        void queryClient.invalidateQueries({ queryKey: ['accounts', cid] });
        show(fresh, false);
        setNotice(e.message);
      } else if (expired(e) && file) {
        void check(file, EXPIRED_NOTICE);
      } else {
        setNotice(errorText(e));
        setStatus(errorText(e));
      }
    } finally {
      setCommitting(false);
      props.onBusy(false);
    }
  };

  const pick = () => inputRef.current?.click();
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={IMPORT_ACCEPT}
      data-import-file=""
      tabIndex={-1}
      aria-hidden="true"
      className="hidden"
      onChange={(e) => {
        choose(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  const footerContent =
    phase.kind === 'done' ? (
      <button type="button" onClick={props.onDone} className={`${btnPrimary} h-12 w-full`}>
        Готово
      </button>
    ) : (
      <div className="grid gap-2">
        {notice && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {notice}
          </p>
        )}
        {(() => {
          const why = committing
            ? null
            : preview
              ? reason
              : phase.kind === 'checking'
                ? 'Проверяем файл…'
                : phase.kind === 'fileError'
                  ? 'Выберите другой файл'
                  : 'Выберите файл';
          const disabled = committing || why !== null;
          return (
            <>
              <button
                type="button"
                aria-disabled={disabled || undefined}
                aria-describedby={why ? reasonId : undefined}
                onClick={() => void commit()}
                className={`${btnPrimary} h-12 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
              >
                {committing ? 'Импортируем…' : 'Импортировать'}
              </button>
              {why && (
                <p id={reasonId} className="text-center text-sm text-muted">
                  {why}
                </p>
              )}
            </>
          );
        })()}
      </div>
    );

  return (
    <div className="grid gap-4">
      {fileInput}
      <p role="status" className="sr-only">
        {status}
      </p>
      {phase.kind === 'done' ? (
        <section className="grid gap-2">
          <h3 ref={doneRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            Импорт завершён
          </h3>
          <p>{doneText(phase.result)}</p>
        </section>
      ) : (
        <>
          {file === null ? (
            <div
              data-drop-zone=""
              onDragOver={(e) => {
                if (!isFileDrag([...e.dataTransfer.types])) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(e) => {
                setDragging(false);
                if (!isFileDrag([...e.dataTransfer.types])) return;
                e.preventDefault();
                choose(e.dataTransfer.files[0]);
              }}
              className={`grid justify-items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center ${dragging ? 'border-income bg-income-soft' : 'border-field'}`}
            >
              <span className="text-income-strong">
                <FolderIcon />
              </span>
              <p className="font-semibold [@media(pointer:coarse)]:hidden">Перетяните сюда файл (до 30 МБ)</p>
              <p className="text-sm text-muted [@media(pointer:coarse)]:hidden">или</p>
              <button type="button" onClick={pick} aria-describedby={hintId} className={`${btnSecondary} max-md:h-11 max-md:w-full`}>
                Выберите файл
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-field px-3 py-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium">{file.name}</span> <span className="text-sm text-muted">· {formatFileSize(file.size)}</span>
              </span>
              <button type="button" onClick={() => !committing && pick()} aria-disabled={committing || undefined} className={`${btnSecondary} max-md:h-11 max-md:w-full`}>
                Выбрать другой файл
              </button>
            </div>
          )}
          {sizeError && (
            <p role="alert" className="text-sm text-expense-strong">
              {sizeError}
            </p>
          )}
          <a href={IMPORT_TEMPLATE_HREF} download className="flex min-h-11 items-center gap-2 rounded-xl border border-field px-3 text-sm font-medium hover:bg-field">
            <DownloadIcon />
            Скачать шаблон
          </a>
          <p id={hintId} className="text-sm text-muted">
            Формат — как выгрузка Finmap «Excel» или шаблон: .xlsx или .csv. Импортируется первый лист
          </p>
          {phase.kind === 'checking' && <p className="text-sm text-muted">Проверяем файл…</p>}
          {phase.kind === 'fileError' && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {phase.message}
            </p>
          )}
          {preview && (
            <ImportPreviewView
              preview={preview}
              headingRef={headingRef}
              accounts={accounts.data ?? []}
              baseCurrency={props.company.baseCurrency}
              onCardChange={onCardChange}
            />
          )}
        </>
      )}
      {props.footer && createPortal(footerContent, props.footer)}
    </div>
  );
}
