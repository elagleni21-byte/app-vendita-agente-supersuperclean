import { api, euro } from "./api.js";
import { requireAuth, logout } from "./auth.js";

document.getElementById("btnLogout").addEventListener("click", logout);

const ordersTable = document.getElementById("ordersTable");
const details = document.getElementById("details");
const banner = document.getElementById("banner");

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

function showBannerIfCreated() {
  const u = new URL(window.location.href);
  const created = u.searchParams.get("created");
  if (created) {
    banner.style.display = "inline-block";
    banner.textContent = `✅ Ordine creato (#${created})`;
  }
}

async function loadOrders() {
  const { orders } = await api("/api/orders");
  const rows = [];

  rows.push(`
    <tr>
      <th>ID</th>
      <th>Cliente</th>
      <th>Totale</th>
      <th>Data</th>
      <th></th>
    </tr>
  `);

  for (const o of orders) {
    rows.push(`
      <tr>
        <td>#${o.id}</td>
        <td>${o.customer_name}</td>
        <td>${euro(o.total_cents)}</td>
        <td>${fmtDate(o.created_at)}</td>
        <td><button class="secondary" data-open="${o.id}">Dettagli</button></td>
      </tr>
    `);
  }

  ordersTable.innerHTML = rows.join("");
  ordersTable.querySelectorAll("[data-open]").forEach(btn => {
    btn.addEventListener("click", () => openOrder(Number(btn.dataset.open)));
  });
}

async function openOrder(id) {
  details.innerHTML = "";
  const { order, items } = await api(`/api/orders/${id}`);
  const lines = items
    .map(it => `<tr><td>${it.name}</td><td>${it.qty}</td><td>${euro(it.price_cents)}</td><td>${euro(it.price_cents * it.qty)}</td></tr>`)
    .join("");

  details.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <h2>Ordine #${order.id}</h2>
      <p class="muted">Cliente: <b>${order.customer_name}</b> ${order.customer_email ? `(${order.customer_email})` : ""}</p>
      <p class="muted">Creato: <b>${fmtDate(order.created_at)}</b></p>
      <table class="table" style="margin-top:10px;">
        <tr><th>Prodotto</th><th>Qty</th><th>Prezzo</th><th>Subtotale</th></tr>
        ${lines}
      </table>
      <div style="margin-top:10px; font-size:18px; font-weight:800;">
        Totale: ${euro(order.total_cents)}
      </div>
    </div>
  `;
}

async function main() {
  const me = await requireAuth();
  if (!me) return;

  showBannerIfCreated();
  await loadOrders();
}

main();