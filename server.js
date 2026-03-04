import { initDb, query, getOne, getAll, pool } from "./db.js";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";


const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.redirect("/login.html"));

// ---------- DB init + seed ----------
await initDb();

async function seedIfEmpty() {
  // agente demo (per login)
  const agentCount = await getOne("SELECT COUNT(*)::int as c FROM agents");
  if (agentCount?.c === 0) {
    const password_hash = bcrypt.hashSync("agent123", 10);
    await query(
      "INSERT INTO agents (name, email, password_hash) VALUES ($1, $2, $3)",
      ["Agente Demo", "agent@example.com", password_hash]
    );
  }

  // prodotti demo (come già hai)
  const productCount = await getOne("SELECT COUNT(*)::int as c FROM products");
  if (productCount?.c === 0) {
    const products = [
      ["Smartphone X", 49900, 20],
      ["Cuffie Wireless", 7900, 50],
      ["Laptop Pro", 109900, 10],
      ["Cover Premium", 1900, 100]
    ];
    for (const p of products) {
      await query("INSERT INTO products (name, price_cents, stock) VALUES ($1, $2, $3)", p);
    }
  }

  // profilo pubblico demo (per la ricerca)
  const demoAgent = await getOne("SELECT id FROM agents WHERE email = $1", ["agent@example.com"]);
  if (demoAgent) {
    const existsProfile = await getOne("SELECT id FROM agent_profiles WHERE agent_id = $1", [demoAgent.id]);
    if (!existsProfile) {
      await query(
        `INSERT INTO agent_profiles (agent_id, display_name, city, category, bio, phone, public_email, website)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          demoAgent.id,
          "Agente Demo",
          "Milano",
          "Immobiliare",
          "Ti aiuto a vendere e comprare casa a Milano. Risposte veloci su WhatsApp.",
          "+39 333 000 0000",
          "agent@example.com",
          ""
        ]
      );
    }
  }
}

seedIfEmpty().catch((e) => console.error("Seed error:", e));

// ---------- Auth middleware ----------
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

// ---------- API ----------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email e password richieste" });

    const agent = await getOne("SELECT * FROM agents WHERE email = $1", [email]);
    if (!agent) return res.status(401).json({ error: "Credenziali non valide" });

    const ok = bcrypt.compareSync(password, agent.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenziali non valide" });

    const token = jwt.sign(
      { agentId: agent.id, name: agent.name, email: agent.email },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore server" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  res.json({ me: req.user });
});

app.get("/api/products", auth, async (req, res) => {
  try {
    const products = await getAll(
      "SELECT id, name, price_cents, stock FROM products ORDER BY id DESC"
    );
    res.json({ products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore caricamento prodotti" });
  }
});

// Creazione ordine con TRANSAZIONE (fondamentale)
app.post("/api/orders", auth, async (req, res) => {
  const { customer_name, customer_email, items } = req.body || {};
  if (!customer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Dati ordine non validi" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let total_cents = 0;

    // 1) check + total con lock
    for (const it of items) {
      const qty = Number(it.qty);
      const pid = Number(it.product_id);
      if (!pid || !qty || qty <= 0) throw new Error("Item non valido");

      const pRes = await client.query(
        "SELECT id, price_cents, stock FROM products WHERE id = $1 FOR UPDATE",
        [pid]
      );
      const p = pRes.rows[0];
      if (!p) throw new Error("Prodotto inesistente");
      if (p.stock < qty) throw new Error("Stock insufficiente");

      total_cents += p.price_cents * qty;
    }

    // 2) crea ordine
    const orderRes = await client.query(
      `INSERT INTO orders (agent_id, customer_name, customer_email, total_cents)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.user.agentId, customer_name, customer_email || null, total_cents]
    );
    const order_id = orderRes.rows[0].id;

    // 3) insert items + update stock
    for (const it of items) {
      const qty = Number(it.qty);
      const pid = Number(it.product_id);

      const pRes = await client.query(
        "SELECT id, price_cents, stock FROM products WHERE id = $1 FOR UPDATE",
        [pid]
      );
      const p = pRes.rows[0];

      await client.query(
        "INSERT INTO order_items (order_id, product_id, qty, price_cents) VALUES ($1, $2, $3, $4)",
        [order_id, pid, qty, p.price_cents]
      );

      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [qty, pid]
      );
    }

    await client.query("COMMIT");
    res.json({ order_id });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: e.message || "Errore ordine" });
  } finally {
    client.release();
  }
});

app.get("/api/orders", auth, async (req, res) => {
  try {
    const orders = await getAll(
      "SELECT id, customer_name, customer_email, total_cents, created_at FROM orders WHERE agent_id = $1 ORDER BY id DESC",
      [req.user.agentId]
    );
    res.json({ orders });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore caricamento ordini" });
  }
});

app.get("/api/orders/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const order = await getOne(
      "SELECT id, customer_name, customer_email, total_cents, created_at FROM orders WHERE id = $1 AND agent_id = $2",
      [id, req.user.agentId]
    );
    if (!order) return res.status(404).json({ error: "Ordine non trovato" });

    const items = await getAll(
      `SELECT oi.qty, oi.price_cents, p.name
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [id]
    );

    res.json({ order, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore dettaglio ordine" });
  }
});
app.get("/api/setup-demo", async (req, res) => {
  try {
    const existing = await getOne("SELECT id FROM agents WHERE email = $1", ["agent@example.com"]);
    if (existing) return res.json({ ok: true, message: "Demo già esistente" });

    const password_hash = bcrypt.hashSync("agent123", 10);
    await query(
      "INSERT INTO agents (name, email, password_hash) VALUES ($1, $2, $3)",
      ["Agente Demo", "agent@example.com", password_hash]
    );
   
app.get("/api/reset-demo", async (req, res) => {
  try {
    // cancella eventuale demo
    await query("DELETE FROM agents WHERE email = $1", ["agent@example.com"]);

    // ricrea demo con password corretta
    const password_hash = bcrypt.hashSync("agent123", 10);
    await query(
      "INSERT INTO agents (name, email, password_hash) VALUES ($1, $2, $3)",
      ["Agente Demo", "agent@example.com", password_hash]
    );

    res.json({ ok: true, message: "Demo resettato (agent@example.com / agent123)" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Errore reset demo" });
  }
});

    res.json({ ok: true, message: "Demo creato" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Errore setup demo" });
  }
});
// ------------------- PUBLIC SEARCH (no login) -------------------
// /api/public/agents?q=...&city=...&category=...
app.get("/api/public/agents", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    const city = (req.query.city || "").toString().trim();
    const category = (req.query.category || "").toString().trim();

    const where = [];
    const params = [];
    let i = 1;

    if (q) {
      where.push(`(ap.display_name ILIKE $${i} OR ap.bio ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }
    if (city) {
      where.push(`ap.city ILIKE $${i}`);
      params.push(city);
      i++;
    }
    if (category) {
      where.push(`ap.category ILIKE $${i}`);
      params.push(category);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const agents = await getAll(
      `
      SELECT ap.id, ap.display_name, ap.city, ap.category,
             ap.bio, ap.phone, ap.public_email, ap.website
      FROM agent_profiles ap
      ${whereSql}
      ORDER BY ap.display_name ASC
      LIMIT 50
      `,
      params
    );

    res.json({ agents });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore ricerca agenti" });
  }
});

// Profilo singolo: /api/public/agents/:id
app.get("/api/public/agents/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const agent = await getOne(
      `
      SELECT ap.id, ap.display_name, ap.city, ap.category,
             ap.bio, ap.phone, ap.public_email, ap.website
      FROM agent_profiles ap
      WHERE ap.id = $1
      `,
      [id]
    );

    if (!agent) return res.status(404).json({ error: "Agente non trovato" });
    res.json({ agent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore profilo agente" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server avviato su porta ${PORT}`);
});





