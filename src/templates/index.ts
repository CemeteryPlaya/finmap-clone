import { computerClub } from './computer-club';
import { general } from './general';
import type { BusinessTemplate } from './types';

export const TEMPLATES: readonly BusinessTemplate[] = [computerClub, general];

export function getTemplate(key: string): BusinessTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}
