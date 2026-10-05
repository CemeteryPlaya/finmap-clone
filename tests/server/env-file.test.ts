import { describe, expect, it } from 'vitest';
import { parseEnv, updateEnvText } from '../../scripts/lib/env-file';

describe('env-file', () => {
  it('парсит KEY=VALUE, игнорирует комментарии и кавычки', () => {
    const m = parseEnv('# c\nA=1\nB="два слова"\n\nC=\n');
    expect([...m]).toEqual([['A', '1'], ['B', 'два слова'], ['C', '']]);
  });

  it('обновляет существующие ключи на месте и дописывает новые, сохраняя комментарии', () => {
    const out = updateEnvText('# Порт\nPORT=3000\nAPP_NAME=Учёт\n', { PORT: '3100', SESSION_SECRET: 'abc' });
    expect(out).toBe('# Порт\nPORT=3100\nAPP_NAME=Учёт\nSESSION_SECRET=abc\n');
  });
});
