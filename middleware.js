// Login gate for the Budget app. Runs on Vercel before any file is served.
// Credentials live in Vercel environment variables, never in this code:
//   APP_USERNAME, APP_PASSWORD, SESSION_SECRET
// Your budget is stored in Upstash Redis (Vercel → Storage), which sets
//   KV_REST_API_URL, KV_REST_API_TOKEN
import { next } from "@vercel/functions";

const COOKIE = "__Host-budget_session";
const SESSION_DAYS = 30;
const PUBLIC_FILES = new Set(["/icon.svg", "/manifest.json"]);
const enc = new TextEncoder();

/* ---------- crypto helpers (Web Crypto, available on the Edge runtime) ---------- */
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
// Compare secrets in constant time by comparing their HMACs (fixed length).
async function safeEqual(secret, a, b) {
  return sameBytes(await hmac(secret, "cmp|" + a), await hmac(secret, "cmp|" + b));
}

async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const sig = b64url(await hmac(env.secret, `session|${env.user}|${exp}`));
  return `${exp}.${sig}`;
}
async function validToken(env, token) {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < Date.now() / 1000 || !sig) return false;
  const expected = b64url(await hmac(env.secret, `session|${env.user}|${exp}`));
  return sameBytes(enc.encode(sig), enc.encode(expected));
}
function readCookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* ---------- responses ---------- */
const SEC_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store"
};
function redirect(to, request, extra = {}) {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...extra } });
}
// Blocks forms posted from other websites. Uses Sec-Fetch-Site (sent by all modern
// browsers) and falls back to comparing Origin with the Host the browser used.
function sameOrigin(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return true; // SameSite=Strict cookie still protects the session
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  try { return new URL(origin).host === host; } catch { return false; }
}

function loginPage(error) {
  const msg = error ? `<p class="err" role="alert">That username or password isn't right. Try again.</p>` : "";
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Log in – Budget</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@700&display=swap" rel="stylesheet">
<style>
:root{--bg:#eef1f6;--surface:#fff;--ink:#14264f;--text:#1c2333;--muted:#5d6678;--line:#d6dbe5;--bad:#c8102e;--field:#f6f8fb;--focus:#003ca6;box-sizing:border-box}
@media (prefers-color-scheme:dark){:root{--bg:#0d1424;--surface:#16203a;--ink:#dfe6f5;--text:#e4e8f1;--muted:#98a2b8;--line:#2b3753;--bad:#ff6b7d;--field:#1c2743;--focus:#7fa8ff}}
*,*::before,*::after{box-sizing:inherit}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 "Barlow",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px 24px}
.brand{display:flex;align-items:center;gap:10px;font:700 1.6rem/1 "Barlow Semi Condensed","Arial Narrow",sans-serif;color:var(--ink);margin:0 0 20px}
label{display:block;font-size:.85rem;color:var(--muted);font-weight:500;margin:14px 0 4px}
input{width:100%;background:var(--field);border:1px solid var(--line);border-radius:8px;padding:11px 12px;font:inherit;color:var(--text)}
input:focus-visible,button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
button{margin-top:20px;width:100%;background:#14264f;color:#fff;border:0;border-radius:8px;padding:12px;font:inherit;font-weight:600;cursor:pointer}
@media (prefers-color-scheme:dark){button{background:#ffcd00;color:#0d1424}}
.err{color:var(--bad);margin:0 0 4px;font-weight:500}
</style></head>
<body><main>
<h1 class="brand"><img src="/icon.svg" width="30" height="30" alt="">Budget</h1>
${msg}
<form method="post" action="/login">
<label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Log in</button>
</form>
</main></body></html>`;
  return new Response(html, { status: error ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8", ...SEC_HEADERS } });
}

/* ---------- data API: stores your budget in Upstash Redis ---------- */
const DATA_KEY = "budget:state";
const MAX_BODY = 2_000_000; // 2 MB is years of transactions

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
async function kv(cfg, command) {
  const r = await fetch(cfg.url, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out.error) throw new Error(out.error || `KV ${r.status}`);
  return out.result;
}
function validData(d) {
  return d && typeof d === "object" && Array.isArray(d.categories) && Array.isArray(d.sources) && Array.isArray(d.tx);
}

async function dataApi(request) {
  const cfg = kvConfig();
  if (!cfg) return json({ error: "storage-not-set-up" }, 503);
  try {
    if (request.method === "GET") {
      const raw = await kv(cfg, ["GET", DATA_KEY]);
      if (!raw) return json({ rev: 0, data: null });
      const saved = JSON.parse(raw);
      return json({ rev: saved.rev, data: saved.data, savedAt: saved.savedAt });
    }
    if (request.method === "PUT") {
      if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "too-large" }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: "bad-json" }, 400); }
      if (!validData(body.data) || !Number.isInteger(body.baseRev)) return json({ error: "bad-data" }, 400);
      const raw = await kv(cfg, ["GET", DATA_KEY]);
      const current = raw ? JSON.parse(raw) : { rev: 0, data: null };
      // Another device saved since this one last synced: send its copy back to merge.
      if (!body.force && body.baseRev !== current.rev) return json({ error: "conflict", rev: current.rev, data: current.data }, 409);
      const rev = current.rev + 1;
      await kv(cfg, ["SET", DATA_KEY, JSON.stringify({ rev, data: body.data, savedAt: Date.now() })]);
      return json({ rev });
    }
    return json({ error: "method-not-allowed" }, 405);
  } catch {
    return json({ error: "storage-error" }, 502);
  }
}

/* ---------- main ---------- */
export default async function middleware(request) {
  const env = { user: process.env.APP_USERNAME, pass: process.env.APP_PASSWORD, secret: process.env.SESSION_SECRET };
  if (!env.user || !env.pass || !env.secret || env.secret.length < 32) {
    // Fail closed: nothing is served until the login is configured.
    return new Response("Login isn't set up yet. Add APP_USERNAME, APP_PASSWORD and SESSION_SECRET (32+ characters) in Vercel → Settings → Environment Variables, then redeploy.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const loggedIn = await validToken(env, readCookie(request, COOKIE));

  if (path === "/login") {
    if (request.method === "GET" || request.method === "HEAD") {
      return loggedIn ? redirect("/", request) : loginPage(url.searchParams.has("error"));
    }
    if (request.method === "POST") {
      if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
      let username = "", password = "";
      try {
        const form = await request.formData();
        username = String(form.get("username") || "").trim();
        password = String(form.get("password") || "");
      } catch { /* treated as a failed login */ }
      const okUser = await safeEqual(env.secret, username, env.user);
      const okPass = await safeEqual(env.secret, password, env.pass);
      if (okUser && okPass) {
        const token = await makeToken(env);
        return redirect("/", request, {
          "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`
        });
      }
      await new Promise(r => setTimeout(r, 1000)); // slow down password guessing
      return redirect("/login?error=1", request);
    }
    return new Response("Method not allowed", { status: 405 });
  }

  if (path === "/logout") {
    if (request.method !== "POST" || !sameOrigin(request)) return new Response("Method not allowed", { status: 405 });
    return redirect("/login", request, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }

  if (path === "/api/data") return loggedIn ? dataApi(request) : json({ error: "not-logged-in" }, 401);

  if (PUBLIC_FILES.has(path) || loggedIn) return next();

  const wantsPage = (request.headers.get("accept") || "").includes("text/html");
  return wantsPage ? redirect("/login", request) : new Response("Not logged in", { status: 401, headers: { "Cache-Control": "no-store" } });
}
