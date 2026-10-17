// Sends the "new lead" email.
//
// Primary: Resend (a real email service), used when the RESEND_API_KEY secret exists.
// Backup:  Formspree, used if Resend is not set up or fails. So a lead notification is
//          never silently dropped just because one service has a problem.

const DEFAULT_FORMSPREE_URL = "https://formspree.io/f/mwlkqzel";

export function formatEmailText(p) {
  return [
    `New quote request #${p.lead_id}`,
    "",
    `Name:       ${p.name}`,
    `Phone:      ${p.phone}`,
    `Email:      ${p.email}`,
    "",
    `From:       ${p.moving_from}`,
    `To:         ${p.moving_to}`,
    `Date:       ${p.preferred_date || "not given"}`,
    `Service:    ${p.service_type}`,
    "",
    `Instant estimate: ${p.instant_estimate}`,
    `Estimator answers: ${p.estimate_inputs || "none"}`,
    "",
    `Notes: ${p.notes || "none"}`,
    "",
    `Heard about us: ${p.heard_about_us}`,
    `Campaign (UTM): ${p.utm}`,
    `Landing page:   ${p.landing_page || "n/a"}`,
    `CASL consent:   ${p.casl_consent}`,
  ].join("\n");
}

export function makeNotifier(env, fetchFn = fetch) {
  async function viaResend(p) {
    if (!env.RESEND_API_KEY) return false;
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "GTAH Movers Leads <leads@gtahmovers.ca>",
        to: [env.NOTIFY_TO || "buz@gtahmovers.ca"],
        reply_to: p.email,
        subject: p._subject,
        text: formatEmailText(p),
      }),
    });
    return res.ok;
  }

  async function viaFormspree(p) {
    const res = await fetchFn(env.FORMSPREE_URL || DEFAULT_FORMSPREE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(p),
    });
    return res.ok;
  }

  return async (payload) => {
    try {
      if (await viaResend(payload)) return true;
    } catch (err) {
      console.error("resend failed", err);
    }
    return viaFormspree(payload);
  };
}
