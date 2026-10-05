export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
}

export const CURRENCIES: readonly CurrencyDef[] = [
  { code: 'KZT', name: 'Казахстанский тенге', symbol: '₸', minorUnits: 2 },
  { code: 'USD', name: 'Доллар США', symbol: '$', minorUnits: 2 },
  { code: 'EUR', name: 'Евро', symbol: '€', minorUnits: 2 },
  { code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 },
  { code: 'CNY', name: 'Китайский юань', symbol: '¥', minorUnits: 2 },
  { code: 'GBP', name: 'Фунт стерлингов', symbol: '£', minorUnits: 2 },
  { code: 'KGS', name: 'Киргизский сом', symbol: 'сом', minorUnits: 2 },
  { code: 'UZS', name: 'Узбекский сум', symbol: 'сўм', minorUnits: 2 },
  { code: 'TRY', name: 'Турецкая лира', symbol: '₺', minorUnits: 2 },
  { code: 'AED', name: 'Дирхам ОАЭ', symbol: 'AED', minorUnits: 2 },
  { code: 'AUD', name: 'Австралийский доллар', symbol: 'A$', minorUnits: 2 },
  { code: 'AZN', name: 'Азербайджанский манат', symbol: '₼', minorUnits: 2 },
  { code: 'AMD', name: 'Армянский драм', symbol: '֏', minorUnits: 2 },
  { code: 'BYN', name: 'Белорусский рубль', symbol: 'Br', minorUnits: 2 },
  { code: 'BRL', name: 'Бразильский реал', symbol: 'R$', minorUnits: 2 },
  { code: 'CAD', name: 'Канадский доллар', symbol: 'C$', minorUnits: 2 },
  { code: 'CHF', name: 'Швейцарский франк', symbol: 'CHF', minorUnits: 2 },
  { code: 'CZK', name: 'Чешская крона', symbol: 'Kč', minorUnits: 2 },
  { code: 'DKK', name: 'Датская крона', symbol: 'kr', minorUnits: 2 },
  { code: 'GEL', name: 'Грузинский лари', symbol: '₾', minorUnits: 2 },
  { code: 'HKD', name: 'Гонконгский доллар', symbol: 'HK$', minorUnits: 2 },
  { code: 'HUF', name: 'Венгерский форинт', symbol: 'Ft', minorUnits: 2 },
  { code: 'INR', name: 'Индийская рупия', symbol: '₹', minorUnits: 2 },
  { code: 'IRR', name: 'Иранский риал', symbol: '﷼', minorUnits: 2 },
  { code: 'JPY', name: 'Японская иена', symbol: '¥', minorUnits: 0 },
  { code: 'KRW', name: 'Южнокорейская вона', symbol: '₩', minorUnits: 0 },
  { code: 'KWD', name: 'Кувейтский динар', symbol: 'KD', minorUnits: 3 },
  { code: 'MDL', name: 'Молдавский лей', symbol: 'L', minorUnits: 2 },
  { code: 'MXN', name: 'Мексиканское песо', symbol: 'MX$', minorUnits: 2 },
  { code: 'MYR', name: 'Малайзийский ринггит', symbol: 'RM', minorUnits: 2 },
  { code: 'NOK', name: 'Норвежская крона', symbol: 'kr', minorUnits: 2 },
  { code: 'PLN', name: 'Польский злотый', symbol: 'zł', minorUnits: 2 },
  { code: 'SAR', name: 'Саудовский риял', symbol: 'SAR', minorUnits: 2 },
  { code: 'SEK', name: 'Шведская крона', symbol: 'kr', minorUnits: 2 },
  { code: 'SGD', name: 'Сингапурский доллар', symbol: 'S$', minorUnits: 2 },
  { code: 'TJS', name: 'Таджикский сомони', symbol: 'SM', minorUnits: 2 },
  { code: 'THB', name: 'Тайский бат', symbol: '฿', minorUnits: 2 },
  { code: 'TMT', name: 'Туркменский манат', symbol: 'm', minorUnits: 2 },
  { code: 'UAH', name: 'Украинская гривна', symbol: '₴', minorUnits: 2 },
  { code: 'ZAR', name: 'Южноафриканский рэнд', symbol: 'R', minorUnits: 2 },
];

const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): CurrencyDef {
  const c = byCode.get(code);
  if (!c) throw new Error(`Неизвестная валюта: ${code}`);
  return c;
}
