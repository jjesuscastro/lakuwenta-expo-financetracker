import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, query } from './db.js';
import { compareCategories, monthBounds, reportTotals, type CategoryAmounts } from './reports.js';
import { renderMonthlyReportPdf } from './report-pdf.js';
import { amountSchema, dateSchema, expenseSchema, nameSchema } from './schemas.js';

const app = Fastify({ logger: true });
const directionSchema = z.enum(['OWED_BY_ME', 'OWED_TO_ME']);
type DebtDirection = z.infer<typeof directionSchema>;

await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'development-only-change-me' });

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try { await request.jwtVerify(); }
  catch { return reply.code(401).send({ error: 'Sign in to continue' }); }
}

function userId(request: FastifyRequest): string {
  return (request.user as { sub: string }).sub;
}

function error(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ error: message });
}

function toCents(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

const amountText = (expression: string) => `printf('%d.%02d', (${expression}) / 100, (${expression}) % 100)`;
const txSelect = `SELECT CAST(t.id AS TEXT) AS id, t.type, t.name, ${amountText('t.amount_cents')} AS amount,
  t.transaction_date AS date, CAST(t.category_id AS TEXT) AS categoryId, c.name AS categoryName,
  CAST(t.goal_id AS TEXT) AS goalId, g.name AS goalName, CAST(t.debt_id AS TEXT) AS debtId, d.name AS debtName,
  t.created_at AS createdAt FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
  LEFT JOIN goals g ON g.id=t.goal_id LEFT JOIN debts d ON d.id=t.debt_id`;

app.get('/health', async () => ({ ok: true, database: 'sqlite' }));

app.post('/auth/login', async (request, reply) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(request.body);
  if (!parsed.success) return error(reply, 400, 'Enter a valid email and password');
  const user = query<{ id: string; email: string; password_hash: string }>('SELECT CAST(id AS TEXT) AS id, email, password_hash FROM users WHERE email=?', [parsed.data.email.toLowerCase()]).rows[0];
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return error(reply, 401, 'Email or password is incorrect');
  return { token: app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '30d' }), email: user.email };
});

app.get('/categories', { preHandler: authenticate }, async (request) => {
  return query('SELECT CAST(id AS TEXT) AS id, name, archived=1 AS archived FROM categories WHERE user_id=? ORDER BY archived, name', [userId(request)]).rows;
});

app.post('/categories', { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({ name: nameSchema }).safeParse(request.body);
  if (!parsed.success) return error(reply, 400, 'Category name is required');
  try {
    return reply.code(201).send(query('INSERT INTO categories (user_id,name) VALUES (?,?) RETURNING CAST(id AS TEXT) AS id,name,archived=1 AS archived', [userId(request), parsed.data.name]).rows[0]);
  } catch (cause: any) {
    if (cause.code === 'SQLITE_CONSTRAINT_UNIQUE') return error(reply, 409, 'A category with that name already exists');
    throw cause;
  }
});

app.patch('/categories/:id', { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(request.params);
  const body = z.object({ name: nameSchema.optional(), archived: z.boolean().optional() }).refine((value) => value.name !== undefined || value.archived !== undefined).safeParse(request.body);
  if (!params.success || !body.success) return error(reply, 400, 'Provide a valid category name or archived value');
  try {
    const result = query('UPDATE categories SET name=COALESCE(?,name), archived=COALESCE(?,archived) WHERE id=? AND user_id=? RETURNING CAST(id AS TEXT) AS id,name,archived=1 AS archived',
      [body.data.name ?? null, body.data.archived === undefined ? null : Number(body.data.archived), params.data.id, userId(request)]);
    return result.rowCount ? result.rows[0] : error(reply, 404, 'Category not found');
  } catch (cause: any) {
    if (cause.code === 'SQLITE_CONSTRAINT_UNIQUE') return error(reply, 409, 'A category with that name already exists');
    throw cause;
  }
});

app.get('/transactions', { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).safeParse(request.query);
  if (!parsed.success) return error(reply, 400, 'Month must use YYYY-MM format');
  const id = userId(request);
  if (parsed.data.month) {
    const bounds = monthBounds(parsed.data.month);
    return query(`${txSelect} WHERE t.user_id=? AND t.transaction_date>=? AND t.transaction_date<? ORDER BY t.transaction_date DESC,t.id DESC`, [id,bounds.start,bounds.end]).rows;
  }
  return query(`${txSelect} WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.id DESC LIMIT 100`, [id]).rows;
});

app.get('/activity', { preHandler: authenticate }, async (request) => {
  return query(`${txSelect} WHERE t.user_id=? AND t.type IN ('GOAL_CONTRIBUTION','DEBT_PAYMENT','DEBT_COLLECTION') ORDER BY t.transaction_date DESC,t.id DESC`, [userId(request)]).rows;
});

app.post('/transactions', { preHandler: authenticate }, async (request, reply) => {
  const parsed = expenseSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 400, 'Name, positive amount, date, and category are required');
  const result = query<{ id: string }>(`INSERT INTO transactions (user_id,type,name,amount_cents,transaction_date,category_id)
    SELECT ?,'EXPENSE',?,?,?,? WHERE EXISTS (SELECT 1 FROM categories WHERE id=? AND user_id=? AND archived=0)
    RETURNING CAST(id AS TEXT) AS id`, [userId(request), parsed.data.name, toCents(parsed.data.amount), parsed.data.date, parsed.data.categoryId, parsed.data.categoryId, userId(request)]);
  if (!result.rowCount) return error(reply, 400, 'Choose an active category');
  return reply.code(201).send(query(`${txSelect} WHERE t.id=?`, [result.rows[0].id]).rows[0]);
});

app.patch('/transactions/:id', { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(request.params);
  const parsed = expenseSchema.safeParse(request.body);
  if (!params.success || !parsed.success) return error(reply, 400, 'Name, positive amount, date, and category are required');
  const result = query<{ id: string }>(`UPDATE transactions SET name=?,amount_cents=?,transaction_date=?,category_id=?
    WHERE id=? AND user_id=? AND type='EXPENSE' AND EXISTS (SELECT 1 FROM categories WHERE id=? AND user_id=? AND archived=0)
    RETURNING CAST(id AS TEXT) AS id`, [parsed.data.name,toCents(parsed.data.amount),parsed.data.date,parsed.data.categoryId,params.data.id,userId(request),parsed.data.categoryId,userId(request)]);
  if (!result.rowCount) return error(reply, 404, 'Expense or active category not found');
  return query(`${txSelect} WHERE t.id=?`, [params.data.id]).rows[0];
});

app.delete('/transactions/:id', { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(request.params);
  if (!params.success) return error(reply, 400, 'Invalid transaction id');
  const result = query("DELETE FROM transactions WHERE id=? AND user_id=? AND type IN ('EXPENSE','GOAL_CONTRIBUTION','DEBT_PAYMENT','DEBT_COLLECTION')", [params.data.id,userId(request)]);
  return result.rowCount ? reply.code(204).send() : error(reply, 404, 'Transaction not found');
});

app.get('/goals', { preHandler: authenticate }, async (request) => {
  return query(`SELECT CAST(g.id AS TEXT) AS id,g.name,${amountText('g.target_amount_cents')} AS "targetAmount",g.created_at AS "createdAt",
    ${amountText('COALESCE(SUM(t.amount_cents),0)')} AS saved FROM goals g LEFT JOIN transactions t ON t.goal_id=g.id AND t.type='GOAL_CONTRIBUTION'
    WHERE g.user_id=? GROUP BY g.id ORDER BY g.created_at DESC`, [userId(request)]).rows;
});

app.post('/goals', { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({ name: nameSchema, targetAmount: amountSchema }).safeParse(request.body);
  if (!parsed.success) return error(reply, 400, 'Goal name and positive target amount are required');
  const row = query(`INSERT INTO goals (user_id,name,target_amount_cents) VALUES (?,?,?)
    RETURNING CAST(id AS TEXT) AS id,name,${amountText('target_amount_cents')} AS "targetAmount",created_at AS "createdAt"`, [userId(request),parsed.data.name,toCents(parsed.data.targetAmount)]).rows[0];
  return reply.code(201).send({ ...row, saved: '0.00' });
});

app.post('/goals/:id/contributions', { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(request.params);
  const parsed = z.object({ name: nameSchema, amount: amountSchema, date: dateSchema }).safeParse(request.body);
  if (!params.success || !parsed.success) return error(reply, 400, 'Name, positive amount, and date are required');
  const result = query<{ id: string }>(`INSERT INTO transactions (user_id,type,name,amount_cents,transaction_date,goal_id)
    SELECT ?,'GOAL_CONTRIBUTION',?,?,?,? WHERE EXISTS (SELECT 1 FROM goals WHERE id=? AND user_id=?) RETURNING CAST(id AS TEXT) AS id`,
    [userId(request),parsed.data.name,toCents(parsed.data.amount),parsed.data.date,params.data.id,params.data.id,userId(request)]);
  if (!result.rowCount) return error(reply, 404, 'Goal not found');
  return reply.code(201).send(query(`${txSelect} WHERE t.id=?`, [result.rows[0].id]).rows[0]);
});

app.get('/debts', { preHandler: authenticate }, async (request) => {
  const balance = '(d.starting_amount_cents-COALESCE(SUM(t.amount_cents),0))';
  return query(`SELECT CAST(d.id AS TEXT) AS id,d.name,d.direction,${amountText('d.starting_amount_cents')} AS "startingAmount",d.created_at AS "createdAt",
    ${amountText(balance)} AS balance FROM debts d LEFT JOIN transactions t ON t.debt_id=d.id AND ((d.direction='OWED_BY_ME' AND t.type='DEBT_PAYMENT') OR (d.direction='OWED_TO_ME' AND t.type='DEBT_COLLECTION'))
    WHERE d.user_id=? GROUP BY d.id ORDER BY d.created_at DESC`, [userId(request)]).rows;
});

app.post('/debts', { preHandler: authenticate }, async (request, reply) => {
  const parsed = z.object({ name: nameSchema, direction: directionSchema, startingAmount: amountSchema }).safeParse(request.body);
  if (!parsed.success) return error(reply, 400, 'Name, direction, and positive starting amount are required');
  const row = query(`INSERT INTO debts (user_id,name,direction,starting_amount_cents) VALUES (?,?,?,?)
    RETURNING CAST(id AS TEXT) AS id,name,direction,${amountText('starting_amount_cents')} AS "startingAmount",created_at AS "createdAt"`,
    [userId(request),parsed.data.name,parsed.data.direction,toCents(parsed.data.startingAmount)]).rows[0];
  return reply.code(201).send({ ...row, balance: parsed.data.startingAmount });
});

class DebtBalanceError extends Error {}

app.post('/debts/:id/entries', { preHandler: authenticate }, async (request, reply) => {
  const params = z.object({ id: z.string().regex(/^\d+$/) }).safeParse(request.params);
  const parsed = z.object({ name: nameSchema, amount: amountSchema, date: dateSchema }).safeParse(request.body);
  if (!params.success || !parsed.success) return error(reply, 400, 'Name, positive amount, and date are required');
  let insertedId: string;
  try {
    const create = db.transaction(() => {
      const debt = query<{ id: number; direction: DebtDirection; starting_amount_cents: number }>(
        'SELECT id,direction,starting_amount_cents FROM debts WHERE id=? AND user_id=?', [params.data.id,userId(request)]).rows[0];
      if (!debt) throw new Error('DEBT_NOT_FOUND');
      const type = debt.direction === 'OWED_BY_ME' ? 'DEBT_PAYMENT' : 'DEBT_COLLECTION';
      const applied = query<{ amount: number }>('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM transactions WHERE debt_id=? AND type=?', [params.data.id,type]).rows[0].amount;
      if (debt.starting_amount_cents - applied < toCents(parsed.data.amount)) throw new DebtBalanceError('Entry cannot exceed the remaining debt balance');
      return query<{ id: string }>(`INSERT INTO transactions (user_id,type,name,amount_cents,transaction_date,debt_id) VALUES (?,?,?,?,?,?) RETURNING CAST(id AS TEXT) AS id`,
        [userId(request),type,parsed.data.name,toCents(parsed.data.amount),parsed.data.date,params.data.id]).rows[0].id;
    });
    insertedId = create.immediate();
  } catch (cause) {
    if (cause instanceof DebtBalanceError) return error(reply, 400, cause.message);
    if (cause instanceof Error && cause.message === 'DEBT_NOT_FOUND') return error(reply, 404, 'Debt not found');
    throw cause;
  }
  return reply.code(201).send(query(`${txSelect} WHERE t.id=?`, [insertedId]).rows[0]);
});

async function buildReport(request: FastifyRequest, includeStatement = false) {
  const queryParams = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(request.query);
  if (!queryParams.success) throw new Error('Month must use YYYY-MM format');
  const bounds = monthBounds(queryParams.data.month);
  const id = userId(request);
  const byCategory = (start: string, end: string) => query<CategoryAmounts>(`SELECT CAST(c.id AS TEXT) AS "categoryId",c.name,
    ${amountText('SUM(t.amount_cents)')} AS amount FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.user_id=? AND t.type='EXPENSE' AND t.transaction_date>=? AND t.transaction_date<? GROUP BY c.id,c.name`, [id,start,end]).rows;
  const current = byCategory(bounds.start,bounds.end);
  const previous = byCategory(bounds.previousStart,bounds.previousEnd);
  const transactionSums = query<{ type: string; amount: string }>(`SELECT type,${amountText('SUM(amount_cents)')} AS amount FROM transactions
    WHERE user_id=? AND transaction_date>=? AND transaction_date<? GROUP BY type`, [id,bounds.start,bounds.end]).rows;
  const transactions = includeStatement ? query<{ name: string; amount: string; date: string; type: string; categoryName: string | null; goalName: string | null; debtName: string | null }>(`
    SELECT t.name,${amountText('t.amount_cents')} AS amount,t.transaction_date AS date,t.type,c.name AS categoryName,g.name AS goalName,d.name AS debtName
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN goals g ON g.id=t.goal_id LEFT JOIN debts d ON d.id=t.debt_id
    WHERE t.user_id=? AND t.transaction_date>=? AND t.transaction_date<? ORDER BY t.transaction_date DESC,t.id DESC`,
  [id,bounds.start,bounds.end]).rows : undefined;
  return { month: queryParams.data.month, currency: 'PHP', ...reportTotals(transactionSums), categories: compareCategories(current,previous), ...(transactions ? { transactions } : {}) };
}

app.get('/reports/monthly', { preHandler: authenticate }, async (request, reply) => {
  try { return await buildReport(request); }
  catch (cause) { return error(reply, 400, cause instanceof Error ? cause.message : 'Invalid month'); }
});

app.get('/reports/monthly.pdf', { preHandler: authenticate }, async (request, reply) => {
  let report;
  try { report = await buildReport(request, true); }
  catch (cause) { return error(reply, 400, cause instanceof Error ? cause.message : 'Invalid month'); }
  const pdf = await renderMonthlyReportPdf(report);
  reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="lakuenta-${report.month}.pdf"`);
  return reply.send(pdf);
});

async function start() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || !process.env.JWT_SECRET) throw new Error('ADMIN_EMAIL, ADMIN_PASSWORD, and JWT_SECRET must be configured in .env');
  let user = query<{ id: string }>('SELECT CAST(id AS TEXT) AS id FROM users WHERE email=?', [email]).rows[0];
  if (!user) user = query<{ id: string }>('INSERT INTO users (email,password_hash) VALUES (?,?) RETURNING CAST(id AS TEXT) AS id', [email,await bcrypt.hash(password,12)]).rows[0];
  for (const name of ['Bills','Groceries','Takeout','Shopping','Entertainment','Misc']) {
    query('INSERT INTO categories (user_id,name) VALUES (?,?) ON CONFLICT (user_id,name) DO NOTHING', [user.id,name]);
  }
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}

start().catch((cause) => { app.log.error(cause); db.close(); process.exit(1); });
