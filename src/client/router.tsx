import { createBrowserRouter, Navigate } from 'react-router';
import { CompanyGate } from './pages/CompanyGate';
import { CompanyLayout } from './pages/CompanyLayout';
import { JournalPage } from './pages/JournalPage';
import { LoginPage } from './pages/LoginPage';
import { NewCompanyPage } from './pages/NewCompanyPage';
import { RequireAuth } from './pages/RequireAuth';
import { CompaniesSettings } from './pages/settings/CompaniesSettings';
import { ProjectsSettings } from './pages/settings/ProjectsSettings';
import { AccountsSettings } from './pages/settings/AccountsSettings';

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
          { path: 'settings', element: <Navigate to="projects" replace /> },
          { path: 'settings/projects', element: <ProjectsSettings /> },
          { path: 'settings/accounts', element: <AccountsSettings /> },
          { path: 'settings/companies', element: <CompaniesSettings /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
