import { z } from 'zod/v4';

export const addFoodSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  name: z.string().min(1).max(100),

  calories: z.number().finite().min(0).max(10000),

  protein: z.number().finite().min(0).optional(),
  carbs: z.number().finite().min(0).optional(),
  fat: z.number().finite().min(0).optional(),
  fiber: z.number().finite().min(0).optional(),

  quantity: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),

  source: z.enum([
    'measured',
    'label',
    'estimated',
  ]),
}).strict();

export type AddFoodInput = z.infer<typeof addFoodSchema>;
