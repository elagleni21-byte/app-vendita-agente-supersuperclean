import { api, setToken, clearToken, getToken } from "./api.js";

export async function requireAuth() {
  const t = getToken();
  if (!t) {
    window.location.href = "/login.html";
    return;
  }
  try {
    const me = await api("/api/me");
    return me.me;
  } catch {
    clearToken();
    window.location.href = "/login.html";
  }
}

export async function doLogin(email, password) {
  const out = await api("/api/login", { method: "POST", body: { email, password } });
  setToken(out.token);
  return out.agent;
}

export function logout() {
  clearToken();
  window.location.href = "/login.html";
}