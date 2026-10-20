-- ulower — то же, что foldCase из src/shared/search.ts и функция ulower соединения SQLite (db/client.ts):
-- нижний регистр (кириллица и казахские буквы — по Unicode) и «ё» → «е». Поиск журнала и проверка названий проектов.
CREATE OR REPLACE FUNCTION ulower(value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT replace(lower(value), 'ё', 'е') $$;
