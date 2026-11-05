import type { Page } from '@playwright/test';
import { startSenetFake, type SenetFake } from '../../tests/helpers/senet-fake';
import { senetSample, xlTime, type SampleValue } from '../../tests/helpers/senet-samples';
import { clubDemoReports } from './senet-club-demo';

/**
 * Поддельный Senet для e2e и снимков (план 2026-11-02-senet-autopost, задача 16): две закрытые смены «Клуба 1» за
 * последние сутки — с выносом kaspi, ЗП оператора, обедом и нераспознанной выемкой; до них — 60 дней сеансов, бара и
 * кассы для «Аналитики клуба» (план АК-1, задача 10). Только выдуманные данные.
 */
export const SENET_DEMO = { org: 'club-demo', username: 'reports', password: 'senet-demo-1' } as const;

const HOUR = 3_600_000;
const MIN = 60_000;
/** Местное время клуба (UTC+5) строкой xlsx. */
const local = (ms: number) => new Date(ms + 5 * HOUR).toISOString().replace('T', ' ').slice(0, 19);

export async function startSenetDemo(now = Date.now()): Promise<SenetFake> {
  const a = { open: now - 30 * HOUR, close: now - 18 * HOUR };
  const b = { open: a.close + MIN, close: now - 6 * HOUR };
  const session = (s: { open: number; close: number }, end: number): SampleValue[] => ['Клуб 1', 'Клуб 1', xlTime(local(s.open)), 'Сотрудник А', xlTime(local(s.close)), 'Сотрудник А', end, end, 0];
  const move = (ms: number, type: 'Внесение средств' | 'Вынесение', amount: number, comment: string | null): SampleValue[] => [
    'Клуб 1',
    xlTime(local(ms)),
    'Сотрудник А',
    type,
    type === 'Вынесение' ? -amount : amount,
    comment,
  ];
  const sessions = senetSample('sessions', [session(a, 10_000), session(b, 12_000)]);
  const moves = senetSample('cashMoves', [
    move(a.open + 5_000, 'Внесение средств', 8_000, null),
    move(a.close - 5 * MIN, 'Вынесение', 2_000, 'kaspi'),
    move(a.close - 2 * MIN, 'Вынесение', 1_500, 'zp op1'),
    move(b.open + 5_000, 'Внесение средств', 10_000, null),
    move(b.close - 4 * MIN, 'Вынесение', 3_000, 'kaspi'),
    move(b.close - 3 * MIN, 'Вынесение', 500, 'obed'),
    move(b.close - 1 * MIN, 'Вынесение', 700, 'что-то'),
  ]);
  // остальные отчёты аналитики — пустые; отчёты клуба — синтетика «Аналитики клуба» до последних 30 часов
  const empty: Record<string, Buffer> = { checks: senetSample('checks', []), shop_quantity: senetSample('stock', []), movements_of_goods: senetSample('goodsMoves', []) };
  const club = clubDemoReports(now);
  return startSenetFake({
    users: { [SENET_DEMO.username]: { password: SENET_DEMO.password, token: 'demo-token-1' } },
    ownAnalytics: true,
    report: (type, q) => (type === 'cashdesk_session' ? sessions : type === 'income_outcome' ? moves : (club(type, q) ?? empty[type] ?? senetSample('transactions', []))),
  });
}

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });
async function post(page: Page, url: string, data: unknown) {
  // забор демо с отчётами клуба идёт дольше 30 с по умолчанию
  const res = await page.request.post(url, { data, headers: csrf(page), timeout: 180_000 });
  if (res.status() >= 300) throw new Error(`POST ${url}: ${res.status()} ${await res.text()}`);
  return res.json();
}

/** Справочники клуба для разноски через API: счета, категории, контрагент, проект; итог — id для формы клуба. */
export async function seedSenetBooks(page: Page, cid: number, now = Date.now()) {
  const c = `/api/v1/companies/${cid}`;
  const openedAt = new Date(now - 60 * 24 * HOUR).toISOString().slice(0, 10);
  const account = async (name: string) => (await post(page, `${c}/accounts`, { name, currency: 'KZT', openedAt, startingBalance: 0 })).account.id as number;
  const category = async (kind: 'income' | 'expense', name: string) => (await post(page, `${c}/categories`, { kind, name })).category.id as number;
  return {
    project: (await post(page, `${c}/projects`, { name: 'Клуб Senet', templateKey: 'general' })).project.id as number,
    cash: await account('Касса Клуб Senet'),
    kaspi: await account('Kaspi Клуб Senet'),
    income: await category('income', 'За смену клуба'),
    salary: await category('expense', 'ЗП смены'),
    lunch: await category('expense', 'Обед'),
    other: await category('expense', 'Прочие расходы клуба'),
    operator: (await post(page, `${c}/counterparties`, { type: 'employee', name: 'Оператор 1' })).counterparty.id as number,
  };
}

/** Подключение, клуб, правила и забор — всё через API (снимки). */
export async function seedSenet(page: Page, cid: number, now = Date.now()) {
  const books = await seedSenetBooks(page, cid, now);
  const s = `/api/v1/companies/${cid}/senet`;
  const conn = (await post(page, `${s}/connections`, { name: 'Клубы', org: SENET_DEMO.org, authMethod: 'password', username: SENET_DEMO.username, password: SENET_DEMO.password })).connection.id as number;
  await post(page, `${s}/rules`, { type: 'salary_word', pattern: '', categoryId: books.salary });
  await post(page, `${s}/rules`, { type: 'lunch', pattern: '', categoryId: books.lunch });
  await post(page, `${s}/rules`, { type: 'employee_alias', pattern: 'op1', counterpartyId: books.operator });
  await post(page, `${s}/connections/${conn}/offices`, {
    senetOfficeId: 1,
    name: 'Клуб 1',
    enabled: true,
    projectId: books.project,
    cashAccountId: books.cash,
    kaspiAccountId: books.kaspi,
    incomeCategoryId: books.income,
    historyFrom: new Date(now - 48 * HOUR).toISOString(),
    cashOffset: -800_000,
  });
  await post(page, `${s}/connections/${conn}/sync`, {});
  return { ...books, conn };
}

/**
 * Клуб «Аналитики клуба» для снимков (план АК-1, задача 10): своё подключение демо-Senet, клуб привязан к проекту-клубу
 * `projectName`, «Загрузить за период» — 30 дней до `now`.
 */
export async function seedSenetClub(page: Page, cid: number, projectName: string, now = Date.now()) {
  const c = `/api/v1/companies/${cid}`;
  const projects = (await (await page.request.get(`${c}/projects`)).json()).projects as { id: number; name: string }[];
  const project = projects.find((p) => p.name === projectName);
  if (!project) throw new Error(`Нет проекта ${projectName}`);
  const s = `${c}/senet`;
  const conn = (await post(page, `${s}/connections`, { name: projectName, org: SENET_DEMO.org, authMethod: 'password', username: SENET_DEMO.username, password: SENET_DEMO.password })).connection.id as number;
  await post(page, `${s}/connections/${conn}/offices`, { senetOfficeId: 1, cashDeskId: 1, enabled: false, projectId: project.id });
  await post(page, `${s}/connections/${conn}/sync`, { from: new Date(now - 30 * 24 * HOUR).toISOString(), to: new Date(now).toISOString() });
}
