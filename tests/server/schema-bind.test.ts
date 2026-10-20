import { is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema';

it('bindSchema: до привязки — таблицы SQLite, после pg — таблицы Postgres; другой диалект после привязки — ошибка', () => {
  expect(schema.currentDialect()).toBe('sqlite');
  expect(is(schema.operations, SQLiteTable)).toBe(true);
  schema.bindSchema('pg');
  expect(schema.currentDialect()).toBe('pg');
  expect(is(schema.operations, PgTable)).toBe(true);
  expect(schema.operations).toBe(schema.pgTables.operations);
  schema.bindSchema('pg'); // повтор того же — без изменений
  expect(() => schema.bindSchema('sqlite')).toThrow('Схема уже привязана к pg');
});
