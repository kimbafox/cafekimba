import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import cors from 'cors';
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT ?? 3000);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatoria.');
}
if (!process.env.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD es obligatoria.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json({ limit: '100kb' }));

function requireAdmin(request, response, next) {
  const header = request.get('authorization');
  const basicPassword = header?.startsWith('Basic ')
    ? Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':')
    : null;
  const password = request.get('x-admin-password') ?? basicPassword;
  if (password !== process.env.ADMIN_PASSWORD) {
    response.set('WWW-Authenticate', 'Basic realm="Kimba Café"');
    return response.status(401).json({ error: 'Acceso de administrador requerido.' });
  }
  next();
}

async function initializeDatabase() {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
}

function product(row) {
  return { id: row.id, name: row.name, category: row.category, price: Number(row.price) };
}

async function salesWithItems(where = '', values = [], limit) {
  const sales = await pool.query(
    `SELECT id, created_at, total FROM sales ${where} ORDER BY created_at DESC ${limit ? `LIMIT ${limit}` : ''}`,
    values,
  );
  if (sales.rows.length === 0) return [];
  const ids = sales.rows.map((sale) => sale.id);
  const items = await pool.query(
    `SELECT sale_id, product_id, product_name, product_category, unit_price, quantity
     FROM sale_items WHERE sale_id = ANY($1::uuid[]) ORDER BY id`,
    [ids],
  );
  const bySale = new Map();
  for (const item of items.rows) {
    const saleItems = bySale.get(item.sale_id) ?? [];
    saleItems.push(item);
    bySale.set(item.sale_id, saleItems);
  }
  return sales.rows.map((sale) => ({
    id: sale.id,
    createdAt: sale.created_at.toISOString(),
    total: Number(sale.total),
    items: (bySale.get(sale.id) ?? []).map((item) => ({
      product: {
        id: item.product_id ?? `deleted-${item.sale_id}`,
        name: item.product_name,
        category: item.product_category,
        price: Number(item.unit_price),
      },
      quantity: item.quantity,
    })),
  }));
}

app.get('/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT id, name, category, price FROM products ORDER BY category, name');
    response.json(result.rows.map(product));
  } catch (error) {
    next(error);
  }
});

app.post('/api/products', requireAdmin, async (request, response, next) => {
  const { name, category, price } = request.body;
  if (!isValidProduct(name, category, price)) {
    return response.status(400).json({ error: 'Producto inválido.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO products (name, category, price) VALUES ($1, $2, $3) RETURNING id, name, category, price',
      [name.trim(), category, price],
    );
    response.status(201).json(product(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.put('/api/products/:id', requireAdmin, async (request, response, next) => {
  const { name, category, price } = request.body;
  if (!isValidProduct(name, category, price)) {
    return response.status(400).json({ error: 'Producto inválido.' });
  }
  try {
    const result = await pool.query(
      `UPDATE products SET name = $1, category = $2, price = $3
       WHERE id = $4 RETURNING id, name, category, price`,
      [name.trim(), category, price, request.params.id],
    );
    if (result.rowCount === 0) return response.status(404).json({ error: 'Producto no encontrado.' });
    response.json(product(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/products/:id', requireAdmin, async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1', [request.params.id]);
    if (result.rowCount === 0) return response.status(404).json({ error: 'Producto no encontrado.' });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', async (request, response, next) => {
  const date = request.query.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ error: 'La fecha debe tener el formato YYYY-MM-DD.' });
  }
  try {
    const todaySales = await salesWithItems(
      `WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')`,
      [date],
    );
    const latestSales = await salesWithItems('', [], 15);
    response.json({ todaySales, latestSales });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sales', async (request, response, next) => {
  const items = request.body.items;
  if (!Array.isArray(items) || items.length === 0 || items.some((item) => !item || !Number.isInteger(item.quantity) || item.quantity < 1 || typeof item.productId !== 'string')) {
    return response.status(400).json({ error: 'Los productos de la venta no son válidos.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = items.map((item) => item.productId);
    const productResult = await client.query(
      'SELECT id, name, category, price FROM products WHERE id = ANY($1::uuid[])',
      [ids],
    );
    if (productResult.rows.length !== new Set(ids).size) {
      await client.query('ROLLBACK');
      return response.status(400).json({ error: 'Uno o más productos ya no existen.' });
    }
    const products = new Map(productResult.rows.map((item) => [item.id, product(item)]));
    const total = items.reduce((sum, item) => sum + products.get(item.productId).price * item.quantity, 0);
    const sale = await client.query('INSERT INTO sales (total) VALUES ($1) RETURNING id', [total]);
    for (const item of items) {
      const selected = products.get(item.productId);
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, product_category, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sale.rows[0].id, selected.id, selected.name, selected.category, selected.price, item.quantity],
      );
    }
    await client.query('COMMIT');
    response.status(201).json((await salesWithItems('WHERE id = $1', [sale.rows[0].id]))[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/admin/overview', requireAdmin, async (request, response, next) => {
  const date = request.query.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ error: 'La fecha debe tener el formato YYYY-MM-DD.' });
  }
  try {
    const result = await pool.query(
      `WITH ranges AS (
        SELECT
          $1::date AS today,
          date_trunc('week', $1::date)::date AS week_start,
          date_trunc('month', $1::date)::date AS month_start
      ),
      totals AS (
        SELECT
          COALESCE(SUM(s.total) FILTER (WHERE s.created_at::date = ranges.today), 0) AS today_total,
          COALESCE(COUNT(*) FILTER (WHERE s.created_at::date = ranges.today), 0) AS today_orders,
          COALESCE(SUM(s.total) FILTER (
            WHERE s.created_at::date >= ranges.week_start
              AND s.created_at::date <= ranges.today
              AND EXTRACT(ISODOW FROM s.created_at) BETWEEN 1 AND 6
          ), 0) AS week_total,
          COALESCE(SUM(s.total) FILTER (
            WHERE s.created_at::date >= ranges.month_start
              AND s.created_at::date <= ranges.today
              AND EXTRACT(ISODOW FROM s.created_at) BETWEEN 1 AND 6
          ), 0) AS month_total
        FROM sales s CROSS JOIN ranges
      )
      SELECT
        today_total,
        today_orders,
        week_total,
        month_total,
        CASE WHEN EXTRACT(ISODOW FROM today) BETWEEN 1 AND 6 THEN 300 ELSE 0 END AS today_goal,
        300 * (
          SELECT COUNT(*)
          FROM generate_series(week_start, today, INTERVAL '1 day') AS days(workday)
          WHERE EXTRACT(ISODOW FROM workday) BETWEEN 1 AND 6
        ) AS week_goal,
        300 * (
          SELECT COUNT(*)
          FROM generate_series(month_start, today, INTERVAL '1 day') AS days(workday)
          WHERE EXTRACT(ISODOW FROM workday) BETWEEN 1 AND 6
        ) AS month_goal
      FROM totals CROSS JOIN ranges`,
      [date],
    );
    const values = result.rows[0];
    response.json({
      today: { total: Number(values.today_total), orders: Number(values.today_orders), goal: Number(values.today_goal) },
      week: { total: Number(values.week_total), goal: Number(values.week_goal) },
      month: { total: Number(values.month_total), goal: Number(values.month_goal) },
      latestSales: await salesWithItems('', [], 100),
    });
  } catch (error) {
    next(error);
  }
});

app.use(
  '/admin',
  requireAdmin,
  express.static(new URL('./web/', import.meta.url).pathname),
);
app.get('/', (_request, response) => response.redirect('/admin/'));

function isValidProduct(name, category, price) {
  return typeof name === 'string'
    && name.trim().length > 0
    && ['Bebidas calientes', 'Bebidas frías', 'Sándwiches'].includes(category)
    && typeof price === 'number'
    && Number.isFinite(price)
    && price > 0;
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Error interno del servidor.' });
});

initializeDatabase()
  .then(() => app.listen(port, () => console.log(`API listening on port ${port}`)))
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
