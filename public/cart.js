import { api, euro } from "./api.js";
import { requireAuth, logout } from "./auth.js";

const KEY = "cart";

export function getCart() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}

export function saveCart(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function cartCount() {
  return getCart().reduce((s, it) => s + it.qty, 0);
}

export function cartAdd(item) {
  const cart = getCart();
  const found = cart.find(x => x.product_id === item.product_id);
  if (found) found.qty += item.qty;
  else cart.push(item);
  saveCart(cart);
}

function cartRemove(product_id) {
  const cart = getCart().filter(x => x.product_id !== product_id);
  saveCart(cart);
}

function cartUpdateQty(product_id, qty) {
  const cart = getCart();
  const found = cart.find(x => x.product_id === product_id);
  if (!found) return;
  found.qty = qty;
  saveCart(cart);
}

function cartTotalCents() {
  return getCart().reduce((s, it) => s + it.price_cents * it.qty, 0);
}

// --- Page logic (only if elements exist)
const cartTable = document.getElementById("cartTable");
const totalEl = document.getElementById("total");
const msgEl = document.getElementById("msg");
const btnLogout = document.getElementById("btnLogout");

if (btnLogout) btnLogout.addEventListener("click", logout);

function render() {
  if (!cartTable) return;

  const cart = getCart();
  const rows = [];

  rows.push(`
    <tr>
      <th>Prodotto</th>
      <th>Prezzo</th>
      <th>Qty</th>
      <th>Subtotale</th>
      <th></th>
    </tr>
  `);

  for (const it of cart) {
    rows.push(`
      <tr>
        <td>${it.name}</td>
        <td>${euro(it.price_cents)}</td>
        <td>
          <input data-qty="${it.product_id}" type="number" min="1" value="${it.qty}" style="width:90px;" />
        </td>
        <td>${euro(it.price_cents * it.qty)}</td>
        <td><button class="danger" data-del="${it.product_id}">X</button></td>
      </tr>
    `);
  }

  cartTable.innerHTML = rows.join("");
  totalEl.textContent = euro(cartTotalCents());

  // bind events
  cartTable.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      cartRemove(Number(btn.dataset.del));
      render();
    });
  });

  cartTable.querySelectorAll("[data-qty]").forEach(inp => {
    inp.addEventListener("change", () => {
      const pid = Number(inp.dataset.qty);
      const qty = Number(inp.value);
      if (!Number.isFinite(qty) || qty <= 0) {
        inp.value = "1";
        cartUpdateQty(pid, 1);
      } else {
        cartUpdateQty(pid, qty);
      }
      render();
    });
  });
}

async function checkout() {
  msgEl.textContent = "";
  const customerName = document.getElementById("customerName").value.trim();
  const customerEmail = document.getElementById("customerEmail").value.trim();
  const items = getCart().map(({ product_id, qty }) => ({ product_id, qty }));

  if (!customerName) {
    msgEl.textContent = "Inserisci il nome cliente";
    return;
  }
  if (items.length === 0) {
    msgEl.textContent = "Carrello vuoto";
    return;
  }

  try {
    const out = await api("/api/orders", {
      method: "POST",
      body: { customer_name: customerName, customer_email: customerEmail || null, items }
    });
    saveCart([]);
    window.location.href = "/orders.html?created=" + out.order_id;
  } catch (e) {
    msgEl.textContent = e.message;
  }
}

async function mainCartPage() {
  if (!cartTable) return;
  const me = await requireAuth();
  if (!me) return;

  document.getElementById("btnClear").addEventListener("click", () => {
    saveCart([]);
    render();
  });

  document.getElementById("btnCheckout").addEventListener("click", checkout);

  render();
}

mainCartPage();