import { z } from 'zod';
import type { BusinessTemplate } from './types';

export const general: BusinessTemplate = {
  key: 'general',
  name: 'Общий',
  params: z.object({}),
  paramsUi: [],
  categories: { income: [], expense: [] },
  defaultAccounts: [],
  integrations: [],
  metrics: [],
};
