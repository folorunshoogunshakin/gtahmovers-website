// GTAH Movers: instant estimate engine.
//
// Implements CRM Blueprint v2, Appendix B (quote calculator logic) and
// section 7.4 (long distance formula). Pure functions, no network calls and
// no dependencies, so it runs the same in a Cloudflare Worker, in Node tests
// and in a browser.
//
// The engine produces a RANGE, never a single price (Appendix B).
// All amounts are CAD, before HST, unless a field name says otherwise.

import { CONFIG } from "./config.mjs";

const round2 = (n) => Math.round(n * 100) / 100;
const roundHalf = (n) => Math.round(n * 2) / 2;
const money = (n) => "$" + Math.round(n).toLocaleString("en-CA");

const ELEVATOR_STATUSES = ["not_needed", "booked", "none", "shared"];

/**
 * Peak dates (7.2): last three and first two days of the month,
 * May through September. Takes an ISO date string, "YYYY-MM-DD".
 */
export function isPeakDate(isoDate, cfg = CONFIG) {
  if (typeof isoDate !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return false;
  if (!cfg.peak.months.includes(month)) return false;
  return day <= cfg.peak.firstDays || day > daysInMonth - cfg.peak.lastDays;
}

/**
 * Appendix B step 4: access factor.
 * elevatorStatus: "not_needed" | "booked" | "none" | "shared"
 */
export function accessFactor(
  { elevatorStatus = "not_needed", stairsFlights = 0, packingRequired = false },
  cfg = CONFIG
) {
  let factor = 1;
  if (elevatorStatus === "none") factor += cfg.access.elevatorNone;
  if (elevatorStatus === "shared") factor += cfg.access.elevatorShared;
  if (stairsFlights > 1) factor += cfg.access.perExtraFlight * (stairsFlights - 1);
  if (packingRequired) factor += cfg.access.packing;
  return Math.round(factor * 1000) / 1000;
}

/**
 * Section 7.4 long distance formula. Every input is explicit so the blueprint's
 * worked example can be tested exactly.
 *
 * Quote = load labour + line haul + driver return + unload labour
 *       + fuel surcharge + accommodation + materials + contingency
 */
export function longDistanceFormula(
  {
    loadHours,
    unloadHours,
    crewRate,
    distanceKm,
    returnHours,
    overnights,
    materials,
    applyContingency = true,
  },
  cfg = CONFIG
) {
  const ld = cfg.longDistance;
  const loadLabour = loadHours * crewRate;
  const lineHaul = distanceKm * ld.lineHaulPerKm;
  const driverReturn = returnHours * ld.driverReturnRate;
  const unloadLabour = unloadHours * crewRate;
  const fuelSurcharge = lineHaul * ld.fuelSurchargePct;
  const accommodation = overnights * ld.overnightCost;
  const subtotal =
    loadLabour + lineHaul + driverReturn + unloadLabour + fuelSurcharge + accommodation + materials;
  const contingency = applyContingency ? subtotal * ld.contingencyPct : 0;
  return {
    loadLabour: round2(loadLabour),
    lineHaul: round2(lineHaul),
    driverReturn: round2(driverReturn),
    unloadLabour: round2(unloadLabour),
    fuelSurcharge: round2(fuelSurcharge),
    accommodation: round2(accommodation),
    materials: round2(materials),
    subtotal: round2(subtotal),
    contingency: round2(contingency),
    total: round2(subtotal + contingency),
  };
}

function hourlyAmount(hours, rate, minHours, factor, cfg) {
  const adjustedHours = Math.max(hours * factor, minHours);
  return { adjustedHours, subtotal: (adjustedHours + cfg.travelHours) * rate };
}

function validate(input, cfg) {
  const errors = [];
  if (!cfg.homeSizes[input.homeSize]) errors.push("homeSize is not recognised");
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0)
    errors.push("distanceKm must be a number of kilometres, zero or more");
  if (!Number.isInteger(input.stairsFlights) || input.stairsFlights < 0)
    errors.push("stairsFlights must be a whole number, zero or more");
  if (!Number.isInteger(input.heavyItems) || input.heavyItems < 0)
    errors.push("heavyItems must be a whole number, zero or more");
  if (!ELEVATOR_STATUSES.includes(input.elevatorStatus))
    errors.push("elevatorStatus must be one of " + ELEVATOR_STATUSES.join(", "));
  return errors;
}

/**
 * Appendix B. Returns { status: "ok", ... } with a range, or
 * { status: "manual", reason } when no instant estimate should be shown, or
 * { status: "invalid", errors } for bad input.
 *
 * input: {
 *   homeSize, distanceKm,
 *   originCountry = "CA", destinationCountry = "CA",
 *   stairsFlights = 0, elevatorStatus = "not_needed",
 *   packingRequired = false, heavyItems = 0, moveDate = null  // "YYYY-MM-DD"
 * }
 * options.rangeMode (defaults to cfg.rangeMode):
 *   "appendixB"    midpoint estimate, shown as minus 10 to plus 10 percent
 *   "scenarioSpan" local moves only: low from the lowest hours and crew in 7.3,
 *                  high from the highest. Reproduces the 7.3 "typical invoice" table.
 */
export function estimate(rawInput, cfg = CONFIG, options = {}) {
  const rangeMode = options.rangeMode || cfg.rangeMode || "appendixB";
  const input = {
    originCountry: "CA",
    destinationCountry: "CA",
    stairsFlights: 0,
    elevatorStatus: "not_needed",
    packingRequired: false,
    heavyItems: 0,
    moveDate: null,
    ...rawInput,
  };

  const errors = validate(input, cfg);
  if (errors.length) return { status: "invalid", errors };

  if (input.originCountry !== "CA" || input.destinationCountry !== "CA") {
    return {
      status: "manual",
      reason: "cross_border",
      message: "Cross-border moves are quoted individually. We will send you a written quote.",
    };
  }

  const home = cfg.homeSizes[input.homeSize];
  if (home.manual) {
    return {
      status: "manual",
      reason: "project_quote",
      message: "Homes this size are quoted as a project. We will send you a written quote.",
    };
  }

  const ld = cfg.longDistance;
  const km = input.distanceKm;
  const hoursMid = (home.hours[0] + home.hours[1]) / 2;
  const rateAvg = (cfg.crewRates[home.crew[0]] + cfg.crewRates[home.crew[1]]) / 2;
  const minHours = Math.max(...home.crew.map((c) => cfg.minHours[c]));
  const factor = accessFactor(input, cfg);
  const peak = isPeakDate(input.moveDate, cfg);
  const peakMultiplier = peak ? 1 + cfg.peak.surcharge : 1;
  const heavy = input.heavyItems * ((cfg.heavyItem.low + cfg.heavyItem.high) / 2);

  let jobType;
  let base;
  let breakdown;
  let scenarios = null;

  if (km <= cfg.distanceBands.localMaxKm) {
    jobType = "local";
    const h = hourlyAmount(hoursMid, rateAvg, minHours, factor, cfg);
    base = h.subtotal;
    breakdown = {
      baseHours: hoursMid,
      accessFactor: factor,
      adjustedHours: round2(h.adjustedHours),
      travelHours: cfg.travelHours,
      hourlyRate: rateAvg,
    };
    if (rangeMode === "scenarioSpan") {
      const c0 = home.crew[0];
      const c1 = home.crew[1];
      scenarios = {
        low: hourlyAmount(home.hours[0], cfg.crewRates[c0], cfg.minHours[c0], factor, cfg).subtotal,
        high: hourlyAmount(home.hours[1], cfg.crewRates[c1], cfg.minHours[c1], factor, cfg).subtotal,
      };
    }
  } else if (km <= cfg.distanceBands.corridorMaxKm) {
    jobType = "corridor";
    const flatRate = cfg.corridorTiers[home.corridorTier];
    base = cfg.corridorUsesAccessFactor ? flatRate * factor : flatRate;
    breakdown = { corridorTier: home.corridorTier, flatRate, accessFactor: factor };
  } else {
    jobType = "long_distance";
    const loadHours = Math.max(hoursMid * factor, minHours);
    const unloadHours = roundHalf(loadHours * ld.unloadShareOfLoad);
    const returnHours = roundHalf(km / ld.driveSpeedKmh);
    const overnights = Math.max(1, Math.ceil(km / (ld.driveSpeedKmh * ld.maxDrivingHoursPerDay)));
    const f = longDistanceFormula(
      {
        loadHours,
        unloadHours,
        crewRate: rateAvg,
        distanceKm: km,
        returnHours,
        overnights,
        materials: ld.materialsByHomeSize[input.homeSize],
        applyContingency: km > ld.contingencyFromKm,
      },
      cfg
    );
    base = f.total;
    breakdown = { loadHours, unloadHours, returnHours, overnights, ...f };
  }

  const subtotal = (base + heavy) * peakMultiplier;
  let low = subtotal * cfg.range.low;
  let high = subtotal * cfg.range.high;
  if (scenarios) {
    low = (scenarios.low + heavy) * peakMultiplier;
    high = (scenarios.high + heavy) * peakMultiplier;
  }
  const notToExceed = jobType === "local" ? high * cfg.range.notToExceed : null;

  const roundTo = cfg.displayRoundTo;
  const displayLow = roundTo ? Math.floor(low / roundTo) * roundTo : Math.round(low);
  const displayHigh = roundTo ? Math.ceil(high / roundTo) * roundTo : Math.round(high);

  const notes = [];
  if (peak) notes.push({ code: "peak_surcharge", message: "Includes a peak-date surcharge." });
  if (input.packingRequired)
    notes.push({ code: "packing_separate", message: "Packing service and materials are quoted separately." });
  if (input.heavyItems > 0)
    notes.push({ code: "heavy_items_photos", message: "Heavy or specialty items need photos before we can firm up the price." });
  if (jobType === "long_distance")
    notes.push({ code: "long_distance_indicative", message: "Long-distance moves are priced from a documented inventory. This range is indicative." });
  notes.push({ code: "video_survey", message: "Book a 15-minute video walkthrough for a firm quote." });

  return {
    status: "ok",
    jobType,
    rangeMode,
    subtotal: round2(subtotal),
    low: round2(low),
    high: round2(high),
    notToExceed: notToExceed === null ? null : round2(notToExceed),
    lowWithHst: round2(low * (1 + cfg.hstRate)),
    highWithHst: round2(high * (1 + cfg.hstRate)),
    display: {
      low: displayLow,
      high: displayHigh,
      text: `Estimated ${money(displayLow)} to ${money(displayHigh)} before HST.`,
    },
    breakdown: { ...breakdown, heavyItemsFee: round2(heavy), peakApplied: peak },
    notes,
  };
}
