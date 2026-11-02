# Senet (ENESTECH): какие данные можно получить для учёта

Дата: 2026-10-15. Источник — публичное описание API на демо-сервере `https://demo.api.enes.tech/docs/` («Senet Server Public API» 1.0.0, схема `/_openapi_scheme/`). Статья поддержки «SENET API» (enestech.zendesk.com) открывается только после входа.

## Доступ
- **Адрес сервера.** У каждой организации свой сервер: `https://{имя-организации}.api.enes.tech/`. Описание API лежит по адресу `…/docs/`.
- **Application Key** — ключ для запросов «сервер — сервер».
  - Выдаёт техподдержка ENESTECH по заявке; самостоятельно его не получить.
  - Передаётся заголовком `Authorization: Key {ключ}`.
  - В браузерный код его класть нельзя. У нас он хранится только на сервере.
  - Поддержка советует отдельный ключ на каждого сотрудника, чтобы видеть, кто что делал.
- **Bearer Token** — токен входа пользователя, живёт 300 дней. Для нашей задачи не нужен.
- **Даты** — ISO 8601 с часовым поясом.
- **Отчёты:**
  - отдают `format=json` или `format=xlsx`;
  - обязательны параметры `office_id` (клуб), `from_date` и `to_date`;
  - постраничной выдачи у отчётов нет.

## Что полезно для учёта

| Запрос | Что это | Чем полезно нам |
|---|---|---|
| `GET /reports/webcash_detail/` | Отчёт по кассе, детальный (фильтр — логин кассира) | Выручка по кассе за период — главная цифра для сверки |
| `GET /reports/old_cashdesk_session/` | Кассовые смены (фильтр — касса) | Смена: открыта, закрыта, кассир, итоги — сверка «по смене» |
| `GET /reports/cashdesk_transactions/` | Транзакции: продажи (`check.sell`) и возвраты (`check.refund`) | Продажи минус возвраты по дням |
| `GET /reports/sold_check_items/`, `…/sold_check_items_detail/` | Кассовые операции, проданные чеки по позициям | Выручка по видам: время, бар, услуги, комбо |
| `GET /reports/income_outcome/` | Внесения и выемки по кассе | Деньги, взятые из кассы на расходы и инкассацию, — кандидаты в расходы и переводы |
| `GET /reports/refill/` | Пополнения баланса гостей | Предоплата гостей — деньги пришли, но время ещё не использовано |
| `GET /reports/balance_operations/` | Операции с балансом гостей (фильтр — способ оплаты, тип) | Наличные, карта и онлайн по пополнениям |
| `GET /cashdesk/{id}/cashdesk_operations/` | Все операции кассы: сумма, `payment_type` (0 — наличные, 1 — карта), статус, смена, кассир, время | Разделение наличные / карта — для счетов «Касса» и «Kaspi» |
| `GET /reports/check_cancel/` | Возвраты | Контроль возвратов |
| `GET /reports/profit_with_royalty/` | Прибыль с роялти | Сверка с франшизой, если есть |
| `GET /reports/movements_of_goods/`, `…/shop_entities_balance/`, `…/shop_quantity/` | Движение и остатки товаров бара | Себестоимость и остатки бара — позже |
| `GET /reports/office_load/`, `…/office_load_by_zones/`, `…/unique_users*` | Загрузка клуба и посещаемость | Метрики шаблона «Компьютерный клуб» (загрузка ПК) — для отчётов этапа 2 |
| `GET /workstations/` | ПК и консоли: номер, зона, тип | Параметры «Количество ПК» и «Количество консолей» |

## Рабочий сервер клуба (проверено 2026-10-15, только чтение описания)
- **Версии отчётов.** На рабочем сервере 50 запросов. Вместо `old_cashdesk_session` и `old_webcash` демо-сервера есть новые `GET /reports/cashdesk_session/` («Кассовые смены», фильтр `cashdesk_id`) и `GET /reports/webcash/` («Отчёт по кассе (общий)»). Разбор должен опираться на описание сервера организации, а не на демо.
- **Список клубов.** Перечисление `office_id` приходит в описании параметров. Наш экран подключения берёт клубы оттуда, отдельного запроса не нужно.
- **Ключ.** Все отчёты и `/workstations/` требуют только Application Key (`security: ApplicationKey`). Вход по логину и паролю (`POST /login/`) выдаёт Bearer-токен учётной записи гостя; к отчётам он не подходит. Значит, без ключа от поддержки ENESTECH подключиться нельзя.

## Чего нет и что надо проверить
- **Поля отчётов не описаны.** В описании отчётов сказано «No response body»; колонки совпадают с отчётами админ-панели Senet. Точный состав полей станет известен только после первого запроса с ключом владельца, и разбор нужно строить по этому образцу.
- **`office_id` — номер клуба в Senet.** Список приходит в подсказках параметров; нужно сопоставить его с нашими проектами.
- **Пределы частоты запросов не указаны.** Достаточно забирать данные раз в день или по кнопке за выбранный период.
- **Только чтение.** Записывающие запросы (`/users/refill/`, `/account/register/`, `/workstations/login/`) нам не нужны и не используются.

## Админ-API (пробный забор 2026-11-03, задача 1 плана 2026-11-02-senet-autopost)

Проверено с учёткой владельца, только чтение. Сырые ответы остались на его машине (`.superpowers/senet-local/`), здесь — только состав.

- **Вход.** `POST https://{org}.app.enes.tech/api/v2/user/idm_admin_auth/` с `{username, password}` → 200, поля ответа: `token`, `is_cashier`, `permissions`, `features`, `keycloak_refresh_token`. Отчёты — `Authorization: Token {token}`.
- **Токен.** Повторный вход выдаёт **новый** токен, а прежний продолжает работать (отчёт по нему — 200). Значит, вход модуля под той же учёткой не выбивает админ-панель.
- **Язык заголовков.** API без `Accept-Language` отдаёт xlsx с **английскими** заголовками; выгрузка из интерфейса — с русскими. Разбор принимает оба, а незнакомые заголовки при том же числе колонок — по позиции.
- **Список клубов.** `GET /api/v2/office/` → массив клубов: `dic_office_id`, `dic_office_name`, `timezone`, `currency`, `pc_count`, `consoles_count`, `is_current`, `is_deleted` и др. (в ответе есть `api_key` — не сохраняется и не показывается). `GET /api/v2/offices/` — 404.
- **Кассы.** `GET /api/v2/cashdesk/` → массив касс: `id`, `name`, `dic_office`, `cashdesk_type`, `is_online`, `is_shift_active`, `is_deleted` и др. У клуба владельца — **две** кассы. `GET /api/v2/cashdesks/` — 404.
- **Отчёты (английские заголовки, по порядку колонок):**
  - `cashdesk_session`: Office name, Cashdesk, Session start date, User who opened session, Session end date, User who closed session, Total amount, Cash, Cashless;
  - `shop_quantity`: Product name, Sold quantity, Restock quantity, Write off quantity, Restock price, Restock price sum, Selling price, Sold price sum, Actual quantity — за окно, без дат строк;
  - `movements_of_goods`: Source order, Cashier login, Product category, Product name, Restock quantity, Write off quantity, Restock price, Restock price sum, Total amount of goods, Sold quantity, Selling price, Sold price sum, Sold price sum in restock price, Profit, Comment — за окно, без дат строк;
  - `office_load`: Office name, Session start date, Session end date, Session duration (hh:mm:ss), User login, Account type, Phone number, Workstation num, Total amount, Tariff name, Cashier login, One-time fee for starting a session, Ticket price — сеансы гостей;
  - `office_load_by_zones`: Office name, Session start date, Session end date, Office zone, Workstation num, User login, Phone number, User age, Tariff name, Amount of funds debited, Amount of replenishment, Session duration (hh:mm:ss) — сеансы по зонам.
- **Обрезка.** `sold_check_items` за октябрь пришёл ровно на 2000 строк и кончился 13.10 — Senet обрезает отчёт; модуль забирает его окнами по суткам.
