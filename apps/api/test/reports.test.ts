import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCategories, monthBounds, reportTotals } from '../src/reports.js';
import { expenseSchema } from '../src/schemas.js';

test('month bounds use consecutive calendar months, including January rollover', () => {
  assert.deepEqual(monthBounds('2026-01'), { start: '2026-01-01', end: '2026-02-01', previousStart: '2025-12-01', previousEnd: '2026-01-01' });
});

test('category comparison reports percent change and marks first-time spending as new', () => {
  const result = compareCategories([
    { categoryId: '1', name: 'Groceries', amount: '1500.00' },
    { categoryId: '2', name: 'Takeout', amount: '400.00' },
  ], [
    { categoryId: '1', name: 'Groceries', amount: '1000.00' },
  ]);
  assert.equal(result.find((item) => item.name === 'Groceries')?.changePercent, 50);
  assert.equal(result.find((item) => item.name === 'Takeout')?.isNew, true);
});

test('month rejects invalid values', () => {
  assert.throws(() => monthBounds('2026-13'));
});

test('expense records require a description, amount, date, and category', () => {
  assert.equal(expenseSchema.safeParse({ name: 'Market run', amount: '240.50', date: '2026-09-29', categoryId: '2' }).success, true);
  assert.equal(expenseSchema.safeParse({ amount: '240.50', date: '2026-09-29', categoryId: '2' }).success, false);
  assert.equal(expenseSchema.safeParse({ name: 'Market run', amount: '0', date: '2026-09-29', categoryId: '2' }).success, false);
  assert.equal(expenseSchema.safeParse({ name: 'Market run', amount: '240.50', date: '2026-02-30', categoryId: '2' }).success, false);
});

test('goal contributions do not affect outflow; debt payments do and collections stay separate', () => {
  assert.deepEqual(reportTotals([
    { type: 'EXPENSE', amount: '100.00' },
    { type: 'GOAL_CONTRIBUTION', amount: '500.00' },
    { type: 'DEBT_PAYMENT', amount: '25.50' },
    { type: 'DEBT_COLLECTION', amount: '60.00' },
  ]), { expenses: '100.00', debtPayments: '25.50', debtCollections: '60.00', totalOutflow: '125.50' });
});
