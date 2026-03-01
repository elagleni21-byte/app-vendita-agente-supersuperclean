import pg from "pg";
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INT NOT NULL CHECK (price_cents >= 0),
      stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      agent_id INT NOT NULL REFERENCES agents(id),
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      total_cents INT NOT NULL CHECK (total_cents >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id),
      qty INT NOT NULL CHECK (qty > 0),
      price_cents INT NOT NULL CHECK (price_cents >= 0)
    );
  `);
}

export async function getOne(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

export async function getAll(text, params = []) {
  const res = await query(text, params);
  return res.rows;
}


