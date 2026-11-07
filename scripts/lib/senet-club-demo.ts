import { senetSample, xlTime, type SampleValue } from '../../tests/helpers/senet-samples';

/**
 * Синтетические отчёты Senet для «Аналитики клуба» (план АК-1, задача 10): 60 дней до `now − 30 ч` — сеансы двух зон,
 * абонементы, бар, пополнения, транзакции кассы. Последние 30 часов пусты: там — смены демо «Сверки», их суммы не
 * трогаются. Детерминированно: псевдослучайность от номера дня. Только выдуманные логины и телефоны.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 5 * HOUR;
const DAYS = 60;
/** Сырые строки, пока окно не попросит: время строки — в колонке `col`. */
type Rows = { rows: SampleValue[][]; at: number[] };

const ZONES = [
  { name: 'Общий зал', from: 1, count: 30, perHour: 350 },
  { name: 'VIP', from: 31, count: 10, perHour: 600 },
] as const;
const GOODS = [
  { name: 'Кола 0,5', price: 450 },
  { name: 'Энергетик', price: 700 },
  { name: 'Чипсы', price: 500 },
  { name: 'Вода', price: 250 },
  { name: 'Сэндвич', price: 900 },
] as const;
const PACKAGES = [
  { name: '3 часа', price: 1_000, minutes: 180 },
  { name: '5 часов', price: 1_500, minutes: 300 },
  { name: 'Ночь', price: 2_500, minutes: 600 },
] as const;
/** Вечерний пик: вес часа начала сеанса. */
const HOUR_WEIGHT = [1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 8, 9, 9, 8, 6, 3];

/** Псевдослучайные числа от seed (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
function pickHour(r: () => number): number {
  const total = HOUR_WEIGHT.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let h = 0; h < 24; h++) {
    x -= HOUR_WEIGHT[h]!;
    if (x < 0) return h;
  }
  return 20;
}
/** Местное время клуба (UTC+5) для xlsx. */
const local = (ms: number) => xlTime(new Date(ms + TZ).toISOString().replace('T', ' ').slice(0, 19));
const guest = (n: number) => ({ login: `guest${String(n).padStart(3, '0')}`, phone: `+7700000${String(1000 + n).slice(-4)}` });

/** Код одноразового чека: 4 знака, как в Senet; различный у сеансов демо (день × 64 + номер сеанса). */
const checkCode = (dayNo: number, i: number) => (dayNo * 64 + i).toString(36).toUpperCase().padStart(4, '0').slice(-4);

/**
 * Кто сидит за сеансом («Гости», §7.1, §19): гости 1–10 в каждом пятом сеансе — под вторым логином `guestNNNm` с тем же
 * телефоном (один гость); каждый 25-й сеанс — общий логин `club` с одним из 5 телефонов, каждый 50-й — без телефона;
 * каждый четвёртый из остальных — одноразовый чек: логин — код чека, без телефона.
 * Без новых случайных чисел: остальные демо-данные не меняются.
 */
function visitor(g: { login: string; phone: string | null }, i: number, dayNo: number): { login: string; phone: string | null; check?: true } {
  if (i % 50 === 7) return { login: 'club', phone: null };
  if (i % 25 === 7) return { login: 'club', phone: `+77009900${String(10 + ((dayNo + i) % 5))}` };
  if (i % 4 === 3) return { login: checkCode(dayNo, i), phone: null, check: true };
  if (i % 5 === 0 && Number(g.login.slice(5)) <= 10) return { login: `${g.login}m`, phone: g.phone };
  return g;
}

/** Строки одного дня клуба. */
function day(start: number, until: number, all: Record<string, Rows>): void {
  const r = rng(Math.floor((start + TZ) / DAY));
  const add = (kind: string, at: number, row: SampleValue[]) => {
    if (at >= until) return;
    all[kind]!.rows.push(row);
    all[kind]!.at.push(at);
  };
  let tx = 0;
  const pay = (at: number, amount: number) =>
    add('transactions', at, ['Клуб 1', '', local(at), `D${Math.floor(at / 1000)}-${tx++}`, 'Покупка чека', amount, r() < 0.6 ? 'Наличный расчет' : 'Безналичный расчет']);
  for (let i = 0; i < 36 + Math.floor(r() * 10); i++) {
    const g = visitor(guest(1 + Math.floor(r() * 120)), i, Math.floor((start + TZ) / DAY));
    const zone = r() < 0.75 ? ZONES[0] : ZONES[1];
    const open = start + pickHour(r) * HOUR + Math.floor(r() * 60) * 60_000;
    const minutes = 60 + Math.floor(r() * 180);
    const close = open + minutes * 60_000;
    const ws = zone.from + Math.floor(r() * zone.count);
    // половина сеансов — по абонементу (списание 0), остальные — поминутно
    const byPackage = r() < 0.5;
    const debited = byPackage ? 0 : Math.round((zone.perHour * minutes) / 60);
    add('load', open, ['Клуб 1', local(open), local(close), zone.name, ws, g.login, g.phone, 19, 'Тариф 1', debited, 0, 0.0625]);
    const paid = byPackage ? pick(r, PACKAGES) : null;
    if (paid) add('tickets', open - 60_000, [g.login, g.phone, paid.name, local(open - 60_000), paid.price, paid.minutes]);
    // чек на время с кассы: одноразовый — свой аккаунт «Check», иначе — пополнение аккаунта гостя «General»; транзакция кассы
    const amount = paid ? paid.price : debited;
    if (amount > 0) {
      const at = open - 120_000;
      r(); // прежний выбор типа: последовательность случайных чисел не меняется
      add('refills', at, ['Клуб 1', local(at), g.login, g.check ? 'Check' : 'General', g.phone ? Number(g.phone.slice(1)) : null, amount, ws]);
      pay(at, amount);
    }
    if (r() < 0.6) {
      const item = pick(r, GOODS);
      const qty = 1 + Math.floor(r() * 3);
      const at = open + 30 * 60_000;
      add('soldItems', at, [local(at), item.name, qty, item.price * qty, 'Наличный расчет', 'Использовано', null]);
      pay(at, item.price * qty);
    }
  }
}

/** Отчёты клуба по окну запроса (`from_date`, `to_date`); не отчёт клуба — null (отвечает основной демо-Senet). */
export function clubDemoReports(now: number): (type: string, q: Record<string, string>) => Buffer | null {
  const until = now - 30 * HOUR;
  const all: Record<string, Rows> = Object.fromEntries(['load', 'tickets', 'refills', 'soldItems', 'transactions'].map((k) => [k, { rows: [], at: [] }]));
  const today = Math.floor((until + TZ) / DAY) * DAY - TZ;
  for (let d = DAYS; d >= 0; d--) day(today - d * DAY, until, all);
  const kinds: Record<string, string> = { office_load_by_zones: 'load', tickets: 'tickets', refill: 'refills', sold_check_items: 'soldItems', cashdesk_transactions: 'transactions' };
  return (type, q) => {
    const kind = kinds[type];
    if (!kind) return null;
    const from = Date.parse(q.from_date ?? '');
    const to = Date.parse(q.to_date ?? '');
    const { rows, at } = all[kind]!;
    return senetSample(kind as Parameters<typeof senetSample>[0], rows.filter((_, i) => at[i]! >= from && at[i]! < to));
  };
}
