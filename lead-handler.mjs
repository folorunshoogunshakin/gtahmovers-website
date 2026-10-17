// Quote-request ("lead") logic. No server or database imports here: storage and
// notification are passed in, so the Worker, the dev server and the tests all
// run this same code.
//
// Order matters: validate -> SAVE -> notify. A lead is never lost because the
// notification service is down.

import { handleEstimateRequest } from "./estimate-handler.mjs";

export const RATE_LIMITS = { windowMs: 60 * 60 * 1000, perIp: 5, perEmail: 3, total: 100 };

const MAX = { short: 200, notes: 3000 };
const clean = (v, max = MAX.short) => (v == null ? "" : String(v).trim().slice(0, max));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS = (p) => p.replace(/\D/g, "");

export const HEARD_OPTIONS = [
  "google", "social_media", "friend_family", "flyer_letter", "online_ad", "review_site", "returning", "other",
];

/**
 * @param {object} body    JSON from the website
 * @param {object} ctx     { now: Date, ip: string|null }
 * @returns {{ ok: true, record: object } | { ok: false, errors: string[] } | { ok: true, spam: true }}
 */
export function buildLeadRecord(body, ctx) {
  if (!body || typeof body !== "object") return { ok: false, errors: ["Request body must be a JSON object"] };
  // Honeypot: real people never fill this hidden field.
  if (clean(body._gotcha)) return { ok: true, spam: true };

  const errors = [];
  const r = {
    created_at: ctx.now.toISOString(),
    first_name: clean(body.first_name),
    last_name: clean(body.last_name),
    phone: clean(body.phone, 40),
    email: clean(body.email).toLowerCase(),
    moving_from: clean(body.moving_from),
    moving_to: clean(body.moving_to),
    preferred_date: clean(body.preferred_date, 20),
    service_type: clean(body.service_type),
    notes: clean(body.notes, MAX.notes),
    heard_about_us: clean(body.heard_about_us, 40),
    utm_source: clean(body.utm_source),
    utm_medium: clean(body.utm_medium),
    utm_campaign: clean(body.utm_campaign),
    utm_term: clean(body.utm_term),
    utm_content: clean(body.utm_content),
    referrer: clean(body.referrer, 500),
    landing_page: clean(body.landing_page, 500),
    casl_consent: body.casl_consent === true || body.casl_consent === "Yes" || body.casl_consent === "on" ? 1 : 0,
    casl_consent_text: clean(body.casl_consent_text, 600),
    consent_ip: ctx.ip || null,
    estimate_low: null,
    estimate_high: null,
    estimate_job_type: null,
    estimate_distance_km: null,
    estimate_inputs: null,
    notify_status: "pending",
  };
  r.casl_consent_at = r.casl_consent ? r.created_at : null;

  if (!r.first_name) errors.push("First name is required");
  if (!r.last_name) errors.push("Last name is required");
  if (PHONE_DIGITS(r.phone).length < 10) errors.push("A valid phone number is required");
  if (!EMAIL_RE.test(r.email)) errors.push("A valid email is required");
  if (!r.casl_consent) errors.push("Consent is required so we can contact you");
  if (!HEARD_OPTIONS.includes(r.heard_about_us)) errors.push("Please tell us how you heard about us");
  if (r.preferred_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.preferred_date)) errors.push("Preferred date is not valid");

  // Re-run the estimate on the server from the structured answers.
  const e = body.estimate_request;
  if (e && typeof e === "object") {
    const { httpStatus, json } = handleEstimateRequest(e);
    if (httpStatus === 200 && json.status === "ok") {
      r.estimate_low = json.display.low;
      r.estimate_high = json.display.high;
      r.estimate_job_type = json.jobType;
      r.estimate_distance_km = json.distanceKmApprox;
    }
    r.estimate_inputs = JSON.stringify(e).slice(0, 1000);
  }

  return errors.length ? { ok: false, errors } : { ok: true, record: r };
}

export const LEAD_COLUMNS = [
  "created_at", "first_name", "last_name", "phone", "email", "moving_from", "moving_to", "preferred_date",
  "service_type", "notes", "heard_about_us", "utm_source", "utm_medium", "utm_campaign", "utm_term",
  "utm_content", "referrer", "landing_page", "casl_consent", "casl_consent_text", "casl_consent_at",
  "consent_ip", "estimate_low", "estimate_high", "estimate_job_type", "estimate_distance_km",
  "estimate_inputs", "notify_status",
];

/** Notification body sent to Formspree (it emails it to you). */
export function notificationPayload(id, r) {
  const money = (n) => (n == null ? null : "$" + n.toLocaleString("en-CA"));
  const est = r.estimate_low != null ? `${money(r.estimate_low)} to ${money(r.estimate_high)} before HST (${r.estimate_job_type})` : "No instant estimate";
  return {
    _subject: `New quote request #${id}: ${r.first_name} ${r.last_name}${r.estimate_low != null ? " (" + money(r.estimate_low) + " to " + money(r.estimate_high) + ")" : ""}`,
    lead_id: id,
    name: `${r.first_name} ${r.last_name}`,
    phone: r.phone,
    email: r.email,
    moving_from: r.moving_from,
    moving_to: r.moving_to,
    preferred_date: r.preferred_date,
    service_type: r.service_type,
    instant_estimate: est,
    estimate_inputs: r.estimate_inputs || "",
    notes: r.notes,
    heard_about_us: r.heard_about_us,
    utm: [r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(" / ") || "none",
    landing_page: r.landing_page,
    casl_consent: r.casl_consent ? "Yes" : "No",
  };
}

/**
 * @param {object} body
 * @param {{ now:Date, ip:string|null, store:{insert:Function, setNotifyStatus:Function}, notify:Function }} deps
 * @returns {Promise<{httpStatus:number, json:object}>}
 */
export async function handleLeadRequest(body, deps) {
  const built = buildLeadRecord(body, deps);
  if (!built.ok) return { httpStatus: 400, json: { status: "invalid", errors: built.errors } };
  if (built.spam) return { httpStatus: 200, json: { status: "ok" } }; // silently drop bots

  // Abuse limits, checked before saving. Uses the lead table itself, so it works
  // across every Worker instance. (Cloudflare's free rate-limit rule only allows
  // a 10-second window, which is too short to stop slow spam.)
  if (deps.store.countRecent) {
    const since = new Date(deps.now.getTime() - RATE_LIMITS.windowMs).toISOString();
    const c = await deps.store.countRecent({ ip: deps.ip || null, email: built.record.email, since });
    if (
      (deps.ip && c.ip >= RATE_LIMITS.perIp) ||
      c.email >= RATE_LIMITS.perEmail ||
      c.total >= RATE_LIMITS.total
    ) {
      return { httpStatus: 429, json: { status: "rate_limited", message: "Too many requests. Please call us instead." } };
    }
  }

  let id;
  try {
    id = await deps.store.insert(built.record);
  } catch (err) {
    console.error("lead save failed", err);
    return { httpStatus: 500, json: { status: "error", message: "Could not save your request" } };
  }

  // The lead is safe. Now notify; a failure here must not fail the request.
  let status = "failed";
  try {
    status = (await deps.notify(notificationPayload(id, built.record))) ? "sent" : "failed";
  } catch (err) {
    console.error("notify failed", err);
  }
  try {
    await deps.store.setNotifyStatus(id, status);
  } catch (err) {
    console.error("status update failed", err);
  }
  return { httpStatus: 200, json: { status: "ok", id } };
}

// ---- CSV export ----
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function leadsToCsv(rows) {
  const cols = ["id", ...LEAD_COLUMNS];
  return [cols.join(","), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(","))].join("\n") + "\n";
}
