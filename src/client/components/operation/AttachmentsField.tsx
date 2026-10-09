import { useId, useState } from 'react';
import {
  ATTACHMENT_ACCEPT,
  attachmentSizeError,
  attachmentUrl,
  formatFileSize,
  removeAttachment,
  uploadAttachment,
  uploadErrorText,
  useAttachments,
} from '../../lib/attachments';
import { ConfirmDelete } from '../ConfirmDelete';

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
}) {
  const inputId = useId();
  const attachments = useAttachments(props.companyId, props.operationId);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  const choose = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    const problems: string[] = [];
    const ok = files.filter((f) => {
      const error = attachmentSizeError(f.size);
      if (error) problems.push(`«${f.name}»: ${error}`);
      return !error;
    });
    if (props.operationId === null) {
      props.onPendingChange([...props.pending, ...ok]);
    } else {
      setUploading(true);
      for (const f of ok) {
        try {
          await uploadAttachment(props.companyId, props.operationId, f);
        } catch (e) {
          problems.push(`«${f.name}»: ${uploadErrorText(e)}`);
        }
      }
      setUploading(false);
    }
    setErrors(problems);
  };

  const remove = async (id: number) => {
    if (props.operationId === null) return;
    setRemoving(true);
    try {
      await removeAttachment(props.companyId, props.operationId, id);
      setConfirmId(null);
    } catch (e) {
      setErrors([uploadErrorText(e)]);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div role="group" aria-label="Файлы" className="md:col-span-2">
      <span className="mb-1 block text-sm text-muted">Файлы</span>
      <ul className="mb-2 grid gap-1 text-sm">
        {(attachments.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            {confirmId === a.id ? (
              <ConfirmDelete what={`файл «${a.originalName}»`} pending={removing} onConfirm={() => void remove(a.id)} onCancel={() => setConfirmId(null)} />
            ) : (
              <>
                <a href={attachmentUrl(props.companyId, a.id)} download className="font-medium text-income underline">
                  {a.originalName}
                </a>
                <span className="text-muted">{formatFileSize(a.size)}</span>
                <button type="button" aria-label={`Удалить файл «${a.originalName}»`} onClick={() => setConfirmId(a.id)} className="text-muted hover:text-expense">
                  ×
                </button>
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
              onClick={() => props.onPendingChange(props.pending.filter((_, j) => j !== i))}
              className="text-muted hover:text-expense"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {/* поле выбора скрыто, видна подпись-кнопка; фокус с клавиатуры подсвечивает подпись */}
      <input
        id={inputId}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        aria-label="Добавить файл"
        disabled={uploading}
        onChange={(e) => {
          void choose(e.target.files);
          e.target.value = '';
        }}
        className="peer sr-only"
      />
      <label htmlFor={inputId} className="inline-block cursor-pointer rounded-lg bg-field px-3 py-1.5 text-sm font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-focus">
        {uploading ? 'Загрузка…' : '+ Файл'}
      </label>
      <span className="ml-2 text-xs text-muted">PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV до 10 МБ</span>
      {errors.length > 0 && (
        <ul role="alert" className="mt-1 text-sm text-expense">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
