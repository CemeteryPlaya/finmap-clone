import { createBrowserRouter } from 'react-router';
import { AppShell } from './pages/AppShell';
import { LoginPage } from './pages/LoginPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '*', element: <AppShell /> },
]);
