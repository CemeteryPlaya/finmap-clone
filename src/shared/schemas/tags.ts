import { z } from 'zod';
import { nameField } from '../text';

export const TAG_NAME_MAX = 50;

export const tagSchema = z.object({ name: nameField(TAG_NAME_MAX) });
