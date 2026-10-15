CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (
    category IN ('Bebidas calientes', 'Bebidas frías', 'Sándwiches')
  ),
  price NUMERIC(10, 2) NOT NULL CHECK (price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, category)
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

INSERT INTO products (name, category, price)
SELECT menu.name, menu.category, menu.price
FROM (
  VALUES
    ('Café negro', 'Bebidas calientes', 3::NUMERIC),
    ('Café con leche', 'Bebidas calientes', 4::NUMERIC),
    ('Capuchino', 'Bebidas calientes', 4::NUMERIC),
    ('Capuchino con esencia', 'Bebidas calientes', 4::NUMERIC),
    ('Latte', 'Bebidas calientes', 5::NUMERIC),
    ('Café frío', 'Bebidas frías', 5::NUMERIC),
    ('Café helado saborizado', 'Bebidas frías', 6::NUMERIC),
    ('Jugo natural', 'Bebidas frías', 5::NUMERIC),
    ('Jugo combinado', 'Bebidas frías', 7::NUMERIC),
    ('Refresco natural', 'Bebidas frías', 3.5::NUMERIC),
    ('Jamón y queso', 'Sándwiches', 6::NUMERIC),
    ('Jamón', 'Sándwiches', 5::NUMERIC)
) AS menu(name, category, price)
WHERE NOT EXISTS (
  SELECT 1
  FROM products
  WHERE products.name = menu.name AND products.category = menu.category
);
