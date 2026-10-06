import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiHarness } from '../helpers/api';

let h: ApiHarness;
afterEach(async () => h?.t.cleanup());

describe('названия и сообщения проверки', () => {
  it('невидимые символы вырезаются, название из одних невидимых символов отклоняется', async () => {
    h = await createApi();
    const empty = await h.req('POST', '/api/v1/companies', { name: '​⁠ ﻿' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.fields.name).toBe('Введите название');
    const ok = await h.req('POST', '/api/v1/companies', { name: ' ТОО​   «Ромашка» ' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().company.name).toBe('ТОО «Ромашка»');
    const project = await h.req('POST', `/api/v1/companies/${ok.json().company.id}/projects`, { name: '​', templateKey: 'general' });
    expect(project.json().error.fields.name).toBe('Введите название');
  });

  it('сообщения zod по умолчанию — на русском', async () => {
    h = await createApi();
    const wrongType = await h.req('POST', '/api/v1/companies', { name: 123 });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error.fields.name).toBe('Неверный формат значения');
    const missing = await h.req('POST', '/api/v1/companies', {});
    expect(missing.json().error.fields.name).toBe('Обязательное поле');
  });
});
