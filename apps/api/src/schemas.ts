import { z } from 'zod';

export const amountSchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).refine((v) => Number(v) > 0, 'Amount must be greater than zero');
export const nameSchema = z.string().trim().min(1).max(120);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Date must be a real calendar date');
export const expenseSchema = z.object({ name: nameSchema, amount: amountSchema, date: dateSchema, categoryId: z.string().regex(/^\d+$/) });
