-- GTAH Movers lead store (Cloudflare D1 / SQLite).
-- One row per quote request. Never deleted by the website.
CREATE TABLE IF NOT EXISTS leads (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at         TEXT NOT NULL,            -- UTC, ISO 8601
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  phone              TEXT NOT NULL,
  email              TEXT NOT NULL,
  moving_from        TEXT,
  moving_to          TEXT,
  preferred_date     TEXT,
  service_type       TEXT,
  notes              TEXT,
  heard_about_us     TEXT,                     -- "How did you hear about us"
  utm_source         TEXT,
  utm_medium         TEXT,
  utm_campaign       TEXT,
  utm_term           TEXT,
  utm_content        TEXT,
  referrer           TEXT,
  landing_page       TEXT,
  -- CASL proof of consent
  casl_consent       INTEGER NOT NULL DEFAULT 0,
  casl_consent_text  TEXT,                     -- exact wording shown
  casl_consent_at    TEXT,
  consent_ip         TEXT,
  -- Instant estimate, recomputed on the server (not trusted from the browser)
  estimate_low       INTEGER,
  estimate_high      INTEGER,
  estimate_job_type  TEXT,
  estimate_distance_km INTEGER,
  estimate_inputs    TEXT,                     -- JSON of what the customer chose
  notify_status      TEXT NOT NULL DEFAULT 'pending'   -- pending | sent | failed
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
