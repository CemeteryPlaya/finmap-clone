import { useEffect, useId, useRef, useState } from 'react';
import {
  ATTACHMENT_ACCEPT,
  attachmentSizeError,
  attachmentTypeError,
  attachmentUrl,
  formatFileSize,
  isFileDrag,
  removeAttachment,
  uploadAttachment,
  uploadErrorText,
  useAttachments,
} from '../../lib/attachments';
import { ConfirmDelete } from '../ConfirmDelete';

export const SAVING_WAIT = 'Дождитесь сохранения, затем добавьте файл';
export const UPLOADING_WAIT = 'Дождитесь окончания загрузки';

/**
 * Файлы операции (§7, §8; API — план 4b). У новой операции выбранные файлы ждут сохранения и загружаются сразу
 * после создания; у существующей файл загружается сразу после выбора. Список: скачивание и мягкое удаление.
 */
export function AttachmentsField(props: {
  companyId: number;
  /** null — операции ещё нет: файлы копятся в pending. */
  operationId: number | null;
  pending: File[];
  onPendingChange: (files: File[]) => void;
  /** Только просмотр (архивная компания): файлы можно скачать, но не добавить и не удалить. */
  readOnly?: boolean;
  /** Файлы, брошенные на форму мимо зоны (блок мог быть свёрнут): добавляются как выбранные; `onIncomingHandled` сообщает форме, что они приняты. */
  incoming?: File[] | null;
  onIncomingHandled?: () => void;
  /** Идёт сохранение операции: брошенный файл не примется (форма уже забрала список) — вместо него сообщение. */
  saving?: boolean;
}) {
  const inputId = useId();
  const hintId = useId();
  const attachments = useAttachments(props.companyId, props.operationId);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  /** Над зоной тащат файлы — подсветка. */
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  /** Куда вернуть фокус после действия с файлом: «×» строки по id или поле выбора файла. */
  const refocus = useRef<{ id: number } | 'input' | null>(null);

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    const el = target === 'input' ? inputRef.current : (removeButtons.current.get(target.id) ?? null);
    if (el && !(el instanceof HTMLInputElement && el.disabled)) {
      el.focus();
      refocus.current = null;
    }
  });

  // файлы, брошенные на форму мимо зоны
  useEffect(() => {
    if (!props.incoming) return;
    const dropped = props.incoming;
    props.onIncomingHandled?.();
    receive(dropped);
  }, [props.incoming]);

  /** Брошенные файлы: во время сохранения или загрузки не теряются молча — сообщение (очередь не ведётся). */
  const receive = (list: Iterable<File> | null) => {
    if (props.saving) setErrors([SAVING_WAIT]);
    else if (uploading) setErrors([UPLOADING_WAIT]);
    else void choose(list);
  };

  // другая операция — прежние ошибки загрузки не относятся к ней
  useEffect(() => setErrors([]), [props.operationId]);

  const choose = async (list: Iterable<File> | null) => {
    const files = [...(list ?? [])];
    const problems: string[] = [];
    const ok = files.filter((f) => {
      const error = attachmentSizeError(f.size) ?? attachmentTypeError(f.name);
      if (error) problems.push(`«${f.name}»: ${error}`);
      return !error;
    });
    if (props.operationId === null) {
      props.onPendingChange([...props.pending, ...ok]);
    } else {
      setUploading(true);
      try {
        for (const f of ok) {
          try {
            await uploadAttachment(props.companyId, props.operationId, f);
          } catch (e) {
            problems.push(`«${f.name}»: ${uploadErrorText(e)}`);
          }
        }
      } finally {
        refocus.current = 'input';
        setUploading(false);
      }
    }
    setErrors(problems);
  };

  const cancelConfirm = (id: number) => {
    refocus.current = { id };
    setConfirmId(null);
  };

  const remove = async (id: number) => {
    if (props.operationId === null) return;
    setRemoving(true);
    const list = attachments.data ?? [];
    const at = list.findIndex((a) => a.id === id);
    const neighbour = list[at + 1] ?? list[at - 1];
    try {
      await removeAttachment(props.companyId, props.operationId, id);
      refocus.current = neighbour ? { id: neighbour.id } : 'input';
      setConfirmId(null);
    } catch (e) {
      setErrors([uploadErrorText(e)]);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div role="group" aria-label="Файлы">
      <span className="mb-1 block text-sm text-muted">Файлы</span>
      {attachments.isError && <p className="mb-1 text-sm text-expense">Не удалось загрузить список файлов</p>}
      <ul className="mb-2 grid gap-1 text-sm">
        {(attachments.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            {confirmId === a.id ? (
              // Esc отменяет только это подтверждение, а не всю форму
              <div
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  e.stopPropagation();
                  cancelConfirm(a.id);
                }}
              >
                <ConfirmDelete what={`файл «${a.originalName}»`} pending={removing} onConfirm={() => void remove(a.id)} onCancel={() => cancelConfirm(a.id)} />
              </div>
            ) : (
              <>
                <a href={attachmentUrl(props.companyId, a.id)} download className="font-medium text-income underline">
                  {a.originalName}
                </a>
                <span className="text-muted">{formatFileSize(a.size)}</span>
                {!props.readOnly && (
                <button
                  type="button"
                  ref={(el) => {
                    if (el) removeButtons.current.set(a.id, el);
                    else removeButtons.current.delete(a.id);
                  }}
                  aria-label={`Удалить файл «${a.originalName}»`}
                  onClick={() => setConfirmId(a.id)} className="text-muted hover:text-expense">
                  ×
                </button>
                )}
              </>
            )}
          </li>
        ))}
        {props.pending.map((f, i) => (
          <li key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{f.name}</span>
            <span className="text-muted">{formatFileSize(f.size)} · загрузится после сохранения</span>
            <button
              type="button"
              aria-label={`Убрать файл «${f.name}»`}
              onClick={() => {
                setErrors([]);
                props.onPendingChange(props.pending.filter((_, j) => j !== i));
              }}
              className="text-muted hover:text-expense"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {/* зона файлов (§6.7 этапа 1.5): перетаскивание или «выберите файл»; поле выбора скрыто, фокус с клавиатуры на нём подсвечивает всю зону */}
      {!props.readOnly && (
        <div
          data-drop-zone=""
          onDragOver={(e) => {
            // файл над зоной не должен открываться браузером, даже пока идёт загрузка
            if (!isFileDrag([...e.dataTransfer.types])) return;
            e.preventDefault();
            if (uploading) return;
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
            // форма не должна принять тот же файл второй раз
            e.stopPropagation();
            receive(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus ${dragging ? 'border-income bg-income-soft' : 'border-field'}`}
        >
          <input
            id={inputId}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            ref={inputRef}
            aria-label="Добавить файл"
            aria-describedby={hintId}
            disabled={uploading}
            onChange={(e) => {
              void choose(e.target.files);
              e.target.value = '';
            }}
            className="peer sr-only"
          />
          {uploading ? (
            <span>Загрузка…</span>
          ) : (
            <span>
              Перетяните сюда файл (до 10 МБ) или{' '}
              <label htmlFor={inputId} className="cursor-pointer font-semibold text-income-strong underline">
                выберите файл
              </label>
            </span>
          )}
          <span id={hintId} className="mt-1 block text-xs text-muted">
            PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV
          </span>
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="mt-1 text-sm text-expense">
          {errors.map((e, i) => (
            <li key={`${i}-${e}`}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
