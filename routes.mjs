// Real-address driving distance via Google Routes, with a cache, spending caps
// and a safe fallback to the built-in city table.
//
// Cost control: Google is only called when (a) the customer typed an address,
// (b) the route is not already cached, (c) the daily and per-visitor caps are
// not used up, (d) the API key is set. Otherwise the estimator quietly uses the
// city table, exactly as before. Traffic-aware routing is NOT requested, which
// keeps the call on Google's cheapest (Essentials) tier.

import { CONFIG } from "./config.mjs";
import { CITIES, OTHER_CANADA } from "./distance.mjs";
import { handleEstimateRequest } from "./estimate-handler.mjs";

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";
const MAX_ADDR = 120;

const tidy = (v) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ADDR) : "";

/** Build the two address strings, or null when no address was typed. */
export function routeAddresses(body) {
  if (!body || typeof body !== "object") return null;
  const fromAddr = tidy(body.fromAddress);
  const toAddr = tidy(body.toAddress);
  if (!fromAddr && !toAddr) return null;
  const build = (addr, key) => {
    const city = CITIES[key];
    if (key === OTHER_CANADA) return addr ? `${addr}, Canada` : null; // address is mandatory
    if (!city) return null;
    return addr ? `${addr}, ${city.label}, Canada` : `${city.label}, Canada`;
  };
  const origin = build(fromAddr, body.fromCity);
  const destination = build(toAddr, body.toCity);
  if (!origin || !destination) return null;
  return { origin, destination };
}

export async function routeKey({ origin, destination }) {
  const text = `${origin}|${destination}`.toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @returns {{km:number|null, source:"cache"|"google"|null, reason?:string}}
 * deps: { apiKey, cache:{get,put}, limiter:{countSince(sinceIso, ip?), log(ip, iso)},
 *         ip, now:Date, cacheOnly:boolean, fetchFn }
 */
export async function resolveRouteKm(body, deps, cfg = CONFIG) {
  const addrs = routeAddresses(body);
  if (!addrs) return { km: null, source: null, reason: "no_address" };
  if (!deps.cache) return { km: null, source: null, reason: "no_cache" };

  const key = await routeKey(addrs);
  const hit = await deps.cache.get(key);
  if (hit != null) return { km: hit, source: "cache" };
  if (deps.cacheOnly) return { km: null, source: null, reason: "not_cached" };
  if (!deps.apiKey) return { km: null, source: null, reason: "no_key" };

  const now = deps.now || new Date();
  const r = cfg.routing;
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const hourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
  if ((await deps.limiter.countSince(dayAgo)) >= r.dailyCallCap) return { km: null, source: null, reason: "daily_cap" };
  if (deps.ip && (await deps.limiter.countSince(hourAgo, deps.ip)) >= r.perIpPerHour) return { km: null, source: null, reason: "ip_cap" };

  await deps.limiter.log(deps.ip || null, now.toISOString()); // count the attempt even if it fails

  const doFetch = deps.fetchFn || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), r.timeoutMs);
  try {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": deps.apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { address: addrs.origin },
        destination: { address: addrs.destination },
        travelMode: "DRIVE",
        regionCode: "CA",
        units: "METRIC",
      }),
    });
    if (!res.ok) return { km: null, source: null, reason: "google_error" };
    const data = await res.json();
    const meters = data?.routes?.[0]?.distanceMeters;
    if (!Number.isFinite(meters) || meters <= 0) return { km: null, source: null, reason: "no_route" };
    const km = Math.max(1, Math.round(meters / 1000));
    await deps.cache.put(key, km, now.toISOString());
    return { km, source: "google" };
  } catch {
    return { km: null, source: null, reason: "google_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** The estimate endpoint with address support. Falls back to the city table. */
export async function handleEstimateWithRoutes(body, deps, cfg = CONFIG) {
  let distanceKm;
  let note = null;
  if (body && typeof body === "object" && (body.fromAddress || body.toAddress)) {
    let r;
    try { r = await resolveRouteKm(body, deps, cfg); } catch { r = { km: null, reason: "route_error" }; }
    if (r.km != null) distanceKm = r.km;
    else note = r.reason;
  }
  const out = handleEstimateRequest(body, cfg, { distanceKm });
  if (note && out.json && out.json.status === "ok") out.json.routeFallback = note;
  return out;
}
