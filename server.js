import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT ?? 3000);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatoria.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json({ limit: '100kb' }));

const initialProducts = [
  ['Café negro', 'Bebidas calientes', 3],
  ['Café con leche', 'Bebidas calientes', 4],
  ['Capuchino', 'Bebidas calientes', 4],
  ['Capuchino con esencia', 'Bebidas calientes', 4],
  ['Latte', 'Bebidas calientes', 5],
  ['Café frío', 'Bebidas frías', 5],
  ['Café helado saborizado', 'Bebidas frías', 6],
  ['Jugo natural', 'Bebidas frías', 5],
  ['Jugo combinado', 'Bebidas frías', 7],
  ['Refresco natural', 'Bebidas frías', 3.5],
  ['Jamón y queso', 'Sándwiches', 6],
  ['Jamón', 'Sándwiches', 5],
];

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      category TEXT NOT NULL CHECK (category IN ('Bebidas calientes', 'Bebidas frías', 'Sándwiches')),
      price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sales (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total NUMERIC(10, 2) NOT NULL CHECK (total >= 0)
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id BIGSERIAL PRIMARY KEY,
      sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id UUID REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      product_category TEXT NOT NULL,
      unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price > 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    CREATE INDEX IF NOT EXISTS sales_created_at_index ON sales(created_at DESC);
    CREATE INDEX IF NOT EXISTS sale_items_sale_id_index ON sale_items(sale_id);
  `);
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM products');
  if (result.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO products (name, category, price)
       SELECT item.name, item.category, item.price
       FROM UNNEST($1::text[], $2::text[], $3::numeric[]) AS item(name, category, price)`,
      [
        initialProducts.map(([name]) => name),
        initialProducts.map(([, category]) => category),
        initialProducts.map(([, , price]) => price),
      ],
    );
  }
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

app.post('/api/products', async (request, response, next) => {
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

app.put('/api/products/:id', async (request, response, next) => {
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

app.delete('/api/products/:id', async (request, response, next) => {
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
