import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { initDb, run, get, all } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDb();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.redirect("/login.html");
});

async function seedIfEmpty() {
  const agentCount = await get("SELECT COUNT(*) as c FROM agents");
  if (agentCount?.c === 0) {
    const password_hash = bcrypt.hashSync("agent123", 10);
    await run(
      "INSERT INTO agents (name, email, password_hash) VALUES (?, ?, ?)",
      ["Agente Demo", "agent@example.com", password_hash]
    );
  }
  const productCount = await get("SELECT COUNT(*) as c FROM products");
  if (productCount?.c === 0) {
    const products = [
      ["Smartphone X", 49900, 20],
      ["Cuffie Wireless", 7900, 50],
      ["Laptop Pro", 109900, 10],
      ["Cover Premium", 1900, 100]
    ];
    for (const p of products) {
      await run("INSERT INTO products (name, price_cents, stock) VALUES (?, ?, ?)", p);
    }
  }
}
seedIfEmpty();

// --- Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --- API
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email e password richieste" });

  const agent = await get("SELECT * FROM agents WHERE email = ?", [email]);
  if (!agent) return res.status(401).json({ error: "Credenziali non valide" });

  const ok = bcrypt.compareSync(password, agent.password_hash);
  if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

  const token = jwt.sign({ agentId: agent.id, name: agent.name, email: agent.email }, JWT_SECRET, {
    expiresIn: "8h"
  });
  res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email } });
});

app.get("/api/me", auth, async (req, res) => {
  res.json({ me: req.user });
});

app.get("/api/products", auth, async (req, res) => {
  const products = await all("SELECT id, name, price_cents, stock FROM products ORDER BY id DESC");
  res.json({ products });
});

app.post("/api/orders", auth, async (req, res) => {
  const { customer_name, customer_email, items } = req.body || {};
  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Dati ordine non validi" });
  }

  // Carica prodotti e calcola totale
  let total_cents = 0;
  for (const it of items) {
    if (!it.product_id || !it.qty || it.qty <= 0) {
      return res.status(400).json({ error: "Item non valido" });
    }
    const p = await get("SELECT id, price_cents, stock FROM products WHERE id = ?", [it.product_id]);
    if (!p) return res.status(400).json({ error: "Prodotto inesistente" });
    if (p.stock < it.qty) return res.status(400).json({ error: "Stock insufficiente" });
    total_cents += p.price_cents * it.qty;
  }

  const now = new Date().toISOString();
  const orderRes = await run(
    "INSERT INTO orders (agent_id, customer_name, customer_email, total_cents, created_at) VALUES (?, ?, ?, ?, ?)",
    [req.user.agentId, customer_name, customer_email || null, total_cents, now]
  );
  const order_id = orderRes.lastID;

  // Inserisci items e aggiorna stock
  for (const it of items) {
    const p = await get("SELECT id, price_cents, stock FROM products WHERE id = ?", [it.product_id]);
    await run(
      "INSERT INTO order_items (order_id, product_id, qty, price_cents) VALUES (?, ?, ?, ?)",
      [order_id, it.product_id, it.qty, p.price_cents]
    );
    await run("UPDATE products SET stock = stock - ? WHERE id = ?", [it.qty, it.product_id]);
  }

  res.json({ order_id });
});

app.get("/api/orders", auth, async (req, res) => {
  const orders = await all(
    "SELECT id, customer_name, customer_email, total_cents, created_at FROM orders WHERE agent_id = ? ORDER BY id DESC",
    [req.user.agentId]
  );
  res.json({ orders });
});

app.get("/api/orders/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const order = await get(
    "SELECT id, customer_name, customer_email, total_cents, created_at FROM orders WHERE id = ? AND agent_id = ?",
    [id, req.user.agentId]
  );
  if (!order) return res.status(404).json({ error: "Ordine non trovato" });

  const items = await all(
    `SELECT oi.qty, oi.price_cents, p.name
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`,
    [id]
  );

  res.json({ order, items });
});

app.listen(PORT, () => {
  console.log(`✅ Server avviato: http://localhost:${PORT}`);
  console.log(`🔐 Login demo: agent@example.com / agent123`);

});
app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server avviato:", PORT);
});
