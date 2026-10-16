import { useOutletContext } from 'react-router';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ReportScreen, type ReportConfig } from './ReportScreen';

const CASHFLOW: ReportConfig = {
  report: 'cashflow',
  title: 'Деньги',
  subtitle: 'Отчёт о движении денежных средств (cash flow)',
  help: 'Отчёт «Деньги» формируется по дате платежа: он показывает движение денег независимо от даты сделки, по всем категориям.',
  dateHeading: 'По дате платежа',
  names: { income: 'Поступления', expense: 'Списания', line: 'Сальдо' },
};

/** «Деньги / Cash flow» (§4 спецификации «Аналитика»). Маршрут не пересоздаёт страницу при смене компании — экран с key. */
export function CashflowPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <ReportScreen key={company.id} company={company} config={CASHFLOW} />;
}
