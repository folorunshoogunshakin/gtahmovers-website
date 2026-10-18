// Cloudflare Worker entry. Handles /api/*; everything else is served from the
// static site in ./public by the assets binding.
//
// Bindings (set up in Stage 4): DB (D1), ASSETS, and secrets
// EXPORT_TOKEN (protects the CSV export) and FORMSPREE_URL (notification only).

import { handleEstimateWithRoutes, resolveRouteKm } from "./routes.mjs";
import { handleLeadRequest, leadsToCsv } from "./lead-handler.mjs";
import { makeNotifier } from "./notify.mjs";

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

async function readJson(request) {
  const text = await request.text();
  if (text.length > 20000) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function d1Store(db) {
  return {
    async insert(r) {
      const cols = Object.keys(r);
      const res = await db
        .prepare(`INSERT INTO leads (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
        .bind(...cols.map((c) => r[c]))
        .run();
      return res.meta.last_row_id;
    },
    async countRecent({ ip, email, since }) {
      const row = await db
        .prepare(
          "SELECT COUNT(*) AS total, " +
          "COALESCE(SUM(CASE WHEN consent_ip = ?1 THEN 1 ELSE 0 END), 0) AS ip, " +
          "COALESCE(SUM(CASE WHEN email = ?2 THEN 1 ELSE 0 END), 0) AS email " +
          "FROM leads WHERE created_at >= ?3"
        )
        .bind(ip, email, since)
        .first();
      return { total: row.total, ip: row.ip, email: row.email };
    },
    async setNotifyStatus(id, status) {
      await db.prepare("UPDATE leads SET notify_status = ? WHERE id = ?").bind(status, id).run();
    },
  };
}

function d1Routes(db) {
  return {
    cache: {
      async get(key) {
        const row = await db.prepare("SELECT km FROM route_cache WHERE key = ?").bind(key).first();
        return row ? row.km : null;
      },
      async put(key, km, iso) {
        await db.prepare("INSERT OR REPLACE INTO route_cache (key, km, created_at) VALUES (?,?,?)").bind(key, km, iso).run();
      },
    },
    limiter: {
      async countSince(iso, ip) {
        const row = ip
          ? await db.prepare("SELECT COUNT(*) AS n FROM route_calls WHERE created_at >= ? AND ip = ?").bind(iso, ip).first()
          : await db.prepare("SELECT COUNT(*) AS n FROM route_calls WHERE created_at >= ?").bind(iso).first();
        return row ? row.n : 0;
      },
      async log(ip, iso) {
        await db.prepare("INSERT INTO route_calls (ip, created_at) VALUES (?,?)").bind(ip, iso).run();
      },
    },
  };
}

// Any database trouble in the routing tables must never break the estimator.
function routeDeps(env, request, extra = {}) {
  try {
    return { ...d1Routes(env.DB), apiKey: env.GOOGLE_MAPS_API_KEY, ip: request.headers.get("CF-Connecting-IP"), now: new Date(), ...extra };
  } catch { return {}; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/estimate" && request.method === "POST") {
      const { httpStatus, json: out } = await handleEstimateWithRoutes(await readJson(request), routeDeps(env, request));
      return json(out, httpStatus);
    }

    if (url.pathname === "/api/lead" && request.method === "POST") {
      const { httpStatus, json: out } = await handleLeadRequest(await readJson(request), {
        now: new Date(),
        ip: request.headers.get("CF-Connecting-IP"),
        store: d1Store(env.DB),
        notify: makeNotifier(env),
        routeKm: async (e) => (await resolveRouteKm(e, routeDeps(env, request, { cacheOnly: true }))).km,
      });
      return json(out, httpStatus);
    }

    if (url.pathname === "/api/leads.csv" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.EXPORT_TOKEN || !safeEqual(auth, `Bearer ${env.EXPORT_TOKEN}`)) return new Response("Unauthorized", { status: 401 });
      const { results } = await env.DB.prepare("SELECT * FROM leads ORDER BY id").all();
      return new Response(leadsToCsv(results), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="gtah-leads.csv"', "Cache-Control": "no-store" },
      });
    }

    if (url.pathname.startsWith("/api/")) return json({ status: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
