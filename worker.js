// Vaishnav Jan — gratitude tree API
// Serves /api/* from D1; everything else comes from ./public via the ASSETS binding.

const COLORS = ["#C8323C", "#E9A23B", "#E3C04B", "#C74C8A", "#4B6FC9", "#4E9A6B"];
const KINDS = ["thanks", "wish"];
const PRIVATE = /(\+?\d[\d\s\-]{8,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|(https?:\/\/|www\.)|(^|\s)@\w{3,}/i;
const ROUGH = /\b(fuck\w*|shit\w*|bitch\w*|bastard|chutiy\w*|madarchod|b[e]?henchod|bhosd\w*|randi|gaand\w*|harami|mc|bc|lodu|lavde)\b/i;

// Rate limits per network: [max actions, window in seconds].
// Kept generous because many Indian mobile users share one IP address (carrier NAT).
const LIMITS = { post: [20, 600], hold: [60, 600] };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const publicNote = r => ({
  id: r.id, kind: r.kind, to: r.to_whom || "", text: r.body, color: r.color,
  at: r.created_at, holds: r.holds, status: r.status,
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// The IP is never stored. A salted, daily-rotating hash is kept for up to a day, only to rate-limit.
async function visitorKey(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  return sha256(`${env.HASH_SALT || "change-me"}:${day}:${ip}`);
}

async function rateLimited(env, key, action) {
  const [max, windowSec] = LIMITS[action];
  const now = Date.now();
  const since = now - windowSec * 1000;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM hits WHERE visitor = ? AND action = ? AND at > ?")
    .bind(key, action, since).first();
  if (row && row.n >= max) return true;
  await env.DB.prepare("INSERT INTO hits (visitor, action, at) VALUES (?, ?, ?)").bind(key, action, now).run();
  // Occasional clean-up of old rate-limit rows
  if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM hits WHERE at < ?").bind(now - 86400000).run();
  return false;
}

function isAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.ADMIN_TOKEN || !token || token.length !== env.ADMIN_TOKEN.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

async function listNotes(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM notes WHERE status = 'live' ORDER BY created_at DESC LIMIT 600"
  ).all();
  return json({ notes: results.map(publicNote) });
}

async function createNote(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }

  const kind = KINDS.includes(body.kind) ? body.kind : null;
  const color = COLORS.includes(body.color) ? body.color : COLORS[0];
  const to = String(body.to || "").trim().slice(0, 60);
  const text = String(body.text || "").trim();

  if (!kind) return json({ error: "invalid", message: "Choose a thank-you or a wish." }, 400);
  if (text.length < 4 || text.length > 280)
    return json({ error: "invalid", message: "Write between a few words and 280 characters." }, 400);
  if (PRIVATE.test(`${to} ${text}`))
    return json({ error: "invalid", message: "Leave out phone numbers, emails, links and handles. Threads stay anonymous." }, 400);
  if (ROUGH.test(`${to} ${text}`))
    return json({ error: "invalid", message: "Only kindness goes on this tree. Rephrase and tie it again." }, 400);

  const key = await visitorKey(request, env);
  if (await rateLimited(env, key, "post")) return json({ error: "rate_limited" }, 429);

  const status = (env.MODERATION || "pre") === "post" ? "live" : "pending";
  const note = { id: crypto.randomUUID(), kind, to_whom: to, body: text, color, created_at: Date.now(), status, holds: 0 };
  await env.DB.prepare(
    "INSERT INTO notes (id, kind, to_whom, body, color, created_at, status, holds) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
  ).bind(note.id, note.kind, note.to_whom, note.body, note.color, note.created_at, note.status).run();

  return json({ note: publicNote(note) }, 201);
}

async function holdNote(request, env, id) {
  const key = await visitorKey(request, env);
  if (await rateLimited(env, key, "hold")) return json({ error: "rate_limited" }, 429);
  const row = await env.DB.prepare(
    "UPDATE notes SET holds = holds + 1 WHERE id = ? AND kind = 'wish' AND status = 'live' RETURNING holds"
  ).bind(id).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ holds: row.holds });
}

async function listPending(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM notes WHERE status = 'pending' ORDER BY created_at ASC LIMIT 200"
  ).all();
  return json({ notes: results.map(publicNote) });
}

async function moderate(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const next = { approve: "live", reject: "rejected", hide: "hidden" }[body.action];
  if (!next) return json({ error: "invalid_action" }, 400);
  const res = await env.DB.prepare("UPDATE notes SET status = ? WHERE id = ?").bind(next, id).run();
  if (!res.meta.changes) return json({ error: "not_found" }, 404);
  return json({ ok: true, status: next });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (path === "/api/notes" && method === "GET") return await listNotes(env);
      if (path === "/api/notes" && method === "POST") return await createNote(request, env);

      let m = path.match(/^\/api\/notes\/([\w-]{1,64})\/hold$/);
      if (m && method === "POST") return await holdNote(request, env, m[1]);

      if (path.startsWith("/api/admin/")) {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
        if (path === "/api/admin/pending" && method === "GET") return await listPending(env);
        m = path.match(/^\/api\/admin\/notes\/([\w-]{1,64})$/);
        if (m && method === "POST") return await moderate(request, env, m[1]);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },
};
