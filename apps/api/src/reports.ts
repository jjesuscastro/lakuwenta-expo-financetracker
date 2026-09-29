export type CategoryAmounts = { categoryId: string; name: string; amount: string };
export type Comparison = CategoryAmounts & { previousAmount: string; changePercent: number | null; isNew: boolean };
export type TransactionTypeAmount = { type: string; amount: string };

export function monthBounds(month: string): { start: string; end: string; previousStart: string; previousEnd: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Month must use YYYY-MM format');
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
  const previousMonth = new Date(Date.UTC(year, monthNumber - 2, 1));
  const format = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { start, end: format(nextMonth), previousStart: format(previousMonth), previousEnd: start };
}

function cents(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

function money(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function reportTotals(records: TransactionTypeAmount[]) {
  const totals = new Map(records.map((record) => [record.type, cents(record.amount)]));
  const expenses = totals.get('EXPENSE') ?? 0;
  const debtPayments = totals.get('DEBT_PAYMENT') ?? 0;
  const debtCollections = totals.get('DEBT_COLLECTION') ?? 0;
  return {
    expenses: money(expenses),
    debtPayments: money(debtPayments),
    debtCollections: money(debtCollections),
    totalOutflow: money(expenses + debtPayments),
  };
}

export function compareCategories(current: CategoryAmounts[], previous: CategoryAmounts[]): Comparison[] {
  const before = new Map(previous.map((item) => [item.categoryId, item]));
  const names = new Map(current.map((item) => [item.categoryId, item.name]));
  for (const item of previous) names.set(item.categoryId, item.name);
  return [...names.entries()].map(([categoryId, name]) => {
    const currentAmount = current.find((item) => item.categoryId === categoryId)?.amount ?? '0.00';
    const previousAmount = before.get(categoryId)?.amount ?? '0.00';
    const currentCents = cents(currentAmount);
    const previousCents = cents(previousAmount);
    return {
      categoryId,
      name,
      amount: money(currentCents),
      previousAmount: money(previousCents),
      changePercent: previousCents === 0 ? null : Math.round(((currentCents - previousCents) / previousCents) * 100),
      isNew: previousCents === 0 && currentCents > 0,
    };
  }).sort((a, b) => cents(b.amount) - cents(a.amount));
}
