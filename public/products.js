import { api, euro } from "./api.js";
import { requireAuth, logout } from "./auth.js";
import { cartAdd, cartCount } from "./cart.js";

const productsEl = document.getElementById("products");
const cartCountEl = document.getElementById("cartCount");
const agentBadge = document.getElementById("agentBadge");

document.getElementById("btnLogout").addEventListener("click", logout);

function renderCount() {
  cartCountEl.textContent = String(cartCount());
}

function productCard(p) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <h2>${p.name}</h2>
    <p class="muted">Prezzo: <b>${euro(p.price_cents)}</b></p>
    <p class="muted">Stock: <b>${p.stock}</b></p>
    <div class="row" style="margin-top:10px;">
      <input type="number" min="1" value="1" />
      <button>Aggiungi</button>
    </div>
    <div class="error" style="min-height:20px;"></div>
  `;
  const qtyInput = el.querySelector("input");
  const btn = el.querySelector("button");
  const err = el.querySelector(".error");

  btn.addEventListener("click", () => {
    err.textContent = "";
    const qty = Number(qtyInput.value);
    if (!Number.isFinite(qty) || qty <= 0) {
      err.textContent = "Quantità non valida";
      return;
    }
    if (qty > p.stock) {
      err.textContent = "Stock insufficiente";
      return;
    }
    cartAdd({ product_id: p.id, name: p.name, price_cents: p.price_cents, qty });
    renderCount();
  });

  return el;
}

async function main() {
  const me = await requireAuth();
  if (!me) return;
  agentBadge.textContent = me.name;

  renderCount();
  const { products } = await api("/api/products");
  productsEl.innerHTML = "";
  for (const p of products) productsEl.appendChild(productCard(p));
}

main();