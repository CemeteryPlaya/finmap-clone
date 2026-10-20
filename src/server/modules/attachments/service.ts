import crypto from 'node:crypto';
import path from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import type { FileStore } from '../../files/store';
import { attachments, operations } from '../../db/schema';
import { AppError } from '../../errors';
import { mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';
import { detectFileType, type DetectedType } from './file-type';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type AttachmentRow = typeof attachments.$inferSelect;

export interface AttachmentsService {
  list(companyId: number, operationId: number): Promise<AttachmentRow[]>;
  add(companyId: number, operationId: number, file: { name: string; data: Buffer }, userId: number): Promise<AttachmentRow>;
  /**
   * Вложение из файла, который браузер уже загрузил в хранилище (режим vercel, Р11): ключ — из POST /uploads/token
   * (uploads/attachment/…) и ещё ничьё; тип и размер — по содержимому. Файл переезжает под attachments/<uuid> (загрузки
   * чистит ежедневное задание); недопустимый файл из хранилища удаляется.
   */
  addStored(companyId: number, operationId: number, file: { key: string; name: string }, userId: number): Promise<AttachmentRow>;
  /** Неудалённое вложение компании. */
  open(companyId: number, id: number): Promise<AttachmentRow>;
  /** Мягкое удаление: файл на диске остаётся (§4.5). */
  remove(companyId: number, id: number, userId: number): Promise<void>;
}

/** Имя файла с расширением, соответствующим типу по содержимому; иначе расширение типа дописывается (не длиннее 200 знаков). */
/** Допустимые расширения имени по типу (по основному расширению типа). */
const ALLOWED_EXTS: Record<string, string[]> = { '.jpg': ['.jpg', '.jpeg'], '.heic': ['.heic', '.heif'] };

function nameForType(name: string, type: DetectedType): string {
  const ext = path.extname(name).toLowerCase();
  if ((ALLOWED_EXTS[type.ext] ?? [type.ext]).includes(ext)) return name;
  return name.slice(0, 200 - type.ext.length) + type.ext;
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте файл', fields);

/** Ключ файла, загруженного браузером для вложения (uploadKey в modules/uploads/routes.ts). */
const STORED_KEY = /^uploads\/attachment\/[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$/;
const notUploaded = () => invalid({ file: 'Файл не загружен — загрузите его снова' });

export function createAttachmentsService(d: { db: Db; audit: AuditService; files: FileStore; now?: () => Date }): AttachmentsService {
  const { db, audit, files } = d;
  const now = d.now ?? (() => new Date());

  async function requireOperation(companyId: number, operationId: number) {
    const op = await first(db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.companyId, companyId))));
    if (!op) throw new AppError(404, 'NOT_FOUND', 'Операция не найдена');
    return op;
  }

  async function requireAttachment(companyId: number, id: number): Promise<AttachmentRow> {
    const row = await first(
      db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.companyId, companyId), isNull(attachments.deletedAt))),
    );
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Вложение не найдено');
    return row;
  }

  /** Компания и операция доступны для записи, имя и содержимое допустимы; тип — по содержимому. */
  async function check(companyId: number, operationId: number, file: { name: string; data: Buffer }) {
    await requireCompany(db, companyId, { writable: true });
    const op = await requireOperation(companyId, operationId);
    if (op.deletedAt) throw new AppError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу');
    const name = cleanName(file.name);
    if (name.length < 1 || name.length > 200) throw invalid({ name: 'Имя файла: от 1 до 200 символов' });
    if (file.data.length === 0) throw invalid({ file: 'Файл пустой' });
    if (file.data.length > ATTACHMENT_MAX_BYTES) throw new AppError(413, 'TOO_LARGE', 'Файл больше 10 МБ');
    const type = detectFileType(file.data, name);
    if (!type) throw invalid({ file: 'Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV' });
    return { name, type };
  }

  /** Строка вложения и история; запись не удалась — файл-сирота удаляется. */
  async function insert(
    companyId: number,
    operationId: number,
    f: { name: string; type: DetectedType; storedName: string; size: number },
    userId: number,
  ): Promise<AttachmentRow> {
    const originalName = nameForType(f.name, f.type);
    try {
      return await mutate(db, audit, async (tx, record) => {
        const [row] = await tx
          .insert(attachments)
          .values({ companyId, operationId, originalName, storedName: f.storedName, mime: f.type.mime, size: f.size, createdAt: now().toISOString() })
          .returning();
        if (!row) throw new Error('attachments: вставка не вернула строку');
        await record({ companyId, userId, entity: 'attachment', entityId: row.id, action: 'create', diff: { operationId, name: originalName, size: row.size, mime: f.type.mime } });
        return row;
      });
    } catch (e) {
      await files.remove(f.storedName);
      throw e;
    }
  }

  return {
    async list(companyId, operationId) {
      await requireCompany(db, companyId);
      await requireOperation(companyId, operationId);
      return db
        .select()
        .from(attachments)
        .where(and(eq(attachments.operationId, operationId), isNull(attachments.deletedAt)))
        .orderBy(asc(attachments.id));
    },

    async add(companyId, operationId, file, userId) {
      const { name, type } = await check(companyId, operationId, file);
      const storedName = `${crypto.randomUUID()}${type.ext}`;
      await files.put(storedName, file.data, type.mime);
      return insert(companyId, operationId, { name, type, storedName, size: file.data.length }, userId);
    },

    async addStored(companyId, operationId, file, userId) {
      await requireCompany(db, companyId, { writable: true });
      if (!STORED_KEY.test(file.key)) throw notUploaded();
      if (await first(db.select({ id: attachments.id }).from(attachments).where(eq(attachments.storedName, file.key)))) throw notUploaded();
      const data = await files.get(file.key);
      if (!data) throw notUploaded();
      let checked: Awaited<ReturnType<typeof check>>;
      try {
        checked = await check(companyId, operationId, { name: file.name, data });
      } catch (e) {
        await files.remove(file.key); // недопустимый файл в хранилище не оставляем
        throw e;
      }
      // загрузки (uploads/) ежедневное задание удаляет через сутки — файл вложения переезжает под постоянный ключ
      const storedName = `attachments/${crypto.randomUUID()}${checked.type.ext}`;
      await files.put(storedName, data, checked.type.mime);
      const row = await insert(companyId, operationId, { ...checked, storedName, size: data.length }, userId);
      await files.remove(file.key);
      return row;
    },

    async open(companyId, id) {
      await requireCompany(db, companyId);
      return requireAttachment(companyId, id);
    },

    async remove(companyId, id, userId) {
      await requireCompany(db, companyId, { writable: true });
      const row = await requireAttachment(companyId, id);
      await mutate(db, audit, async (tx, record) => {
        await tx.update(attachments).set({ deletedAt: now().toISOString() }).where(eq(attachments.id, id));
        await record({ companyId, userId, entity: 'attachment', entityId: id, action: 'delete', diff: { operationId: row.operationId, name: row.originalName } });
      });
    },
  };
}
