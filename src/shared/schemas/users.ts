import { z } from 'zod';
import { nameField } from '../text';

export const MIN_PASSWORD = 10;

const password = z.string().min(MIN_PASSWORD, `Пароль должен быть не короче ${MIN_PASSWORD} символов`).max(256, 'Не длиннее 256 символов');

export const userCreateSchema = z.object({
  login: z.string().trim().min(1, 'Введите логин').max(64, 'Не длиннее 64 символов'),
  name: nameField(100, 'Введите имя'),
  password,
});

export const userUpdateSchema = z.object({
  name: nameField(100, 'Введите имя').optional(),
  /** Сброс пароля другому пользователю. */
  password: password.optional(),
  disabled: z.boolean().optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Введите текущий пароль').max(256),
  newPassword: password,
});
