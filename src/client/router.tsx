import { createBrowserRouter, Navigate } from 'react-router';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CashflowPage } from './pages/analytics/CashflowPage';
import { PnlPage } from './pages/analytics/PnlPage';
import { StatementPage } from './pages/analytics/StatementPage';
import { CompanyGate } from './pages/CompanyGate';
import { CompanyLayout } from './pages/CompanyLayout';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { NewCompanyPage } from './pages/NewCompanyPage';
import { RequireAuth } from './pages/RequireAuth';
import { StockIndex, StockPage } from './pages/StockPage';
import { BalanceTab } from './pages/stock/BalanceTab';
import { DocsTab } from './pages/stock/DocsTab';
import { ItemsTab } from './pages/stock/ItemsTab';
import { CompaniesSettings } from './pages/settings/CompaniesSettings';
import { ProjectsSettings } from './pages/settings/ProjectsSettings';
import { AccountsSettings } from './pages/settings/AccountsSettings';
import { CategoriesSettings } from './pages/settings/CategoriesSettings';
import { CounterpartiesSettings } from './pages/settings/CounterpartiesSettings';
import { TagsSettings } from './pages/settings/TagsSettings';
import { WarehousesSettings } from './pages/settings/WarehousesSettings';
import { SplitPresetsSettings } from './pages/settings/SplitPresetsSettings';
import { RatesSettings } from './pages/settings/RatesSettings';
import { ProfileSettings } from './pages/settings/ProfileSettings';
import { UsersSettings } from './pages/settings/UsersSettings';
import { AuditSettings } from './pages/settings/AuditSettings';
import { BackupSettings } from './pages/settings/BackupSettings';
import { JournalViewSettings } from './pages/settings/JournalViewSettings';
import { SettingsIndex, SettingsLayout, SettingsRedirect } from './pages/settings/SettingsLayout';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <CompanyGate /> },
      { path: 'companies/new', element: <NewCompanyPage /> },
      {
        path: 'c/:companyId',
        element: <CompanyLayout />,
        children: [
          { index: true, element: <Navigate to="log" replace /> },
          { path: 'log', element: <JournalPage /> },
          {
            path: 'analytics',
            children: [
              { index: true, element: <AnalyticsPage /> },
              { path: 'cashflow', element: <CashflowPage /> },
              { path: 'pnl', element: <PnlPage /> },
              { path: 'statement', element: <StatementPage /> },
              { path: '*', element: <Navigate to=".." replace /> },
            ],
          },
          {
            path: 'stock',
            element: <StockPage />,
            children: [
              { index: true, element: <StockIndex /> },
              { path: 'balance', element: <BalanceTab /> },
              { path: 'docs', element: <DocsTab /> },
              { path: 'items', element: <ItemsTab /> },
              { path: '*', element: <StockIndex /> },
            ],
          },
          {
            path: 'settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <SettingsIndex /> },
              { path: 'profile', element: <ProfileSettings /> },
              { path: 'companies', element: <CompaniesSettings /> },
              { path: 'counterparties', element: <CounterpartiesSettings /> },
              { path: 'accounts', element: <AccountsSettings /> },
              { path: 'categories', element: <CategoriesSettings /> },
              { path: 'projects', element: <ProjectsSettings /> },
              { path: 'projects/split-presets', element: <SplitPresetsSettings /> },
              { path: 'split-presets', element: <SettingsRedirect section="projects/split-presets" /> },
              { path: 'tags', element: <TagsSettings /> },
              { path: 'warehouses', element: <WarehousesSettings /> },
              { path: 'users', element: <UsersSettings /> },
              { path: 'rates', element: <RatesSettings /> },
              { path: 'backup', element: <BackupSettings /> },
              { path: 'journal', element: <JournalViewSettings /> },
              { path: 'audit', element: <AuditSettings /> },
              { path: '*', element: <SettingsRedirect section="counterparties" /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
