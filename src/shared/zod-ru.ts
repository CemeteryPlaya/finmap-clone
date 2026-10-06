import { z } from 'zod';

let installed = false;

/**
 * Русские сообщения zod там, где у схемы нет своего текста. Вызывается один раз при старте
 * сервера (buildApp) и клиента (main.tsx). Свои сообщения схем имеют приоритет над этими.
 */
export function installZodRu(): void {
  if (installed) return;
  installed = true;
  z.config(z.locales.ru());
  z.config({
    customError: (issue) => {
      if (issue.code === 'invalid_type') return issue.input === undefined ? 'Обязательное поле' : 'Неверный формат значения';
      return undefined;
    },
  });
}
