// The estimate endpoint's logic, kept separate from any server so the same
// code runs in the Cloudflare Worker, the local test server and the tests.
//
// The website sends plain choices (cities, home size, access details).
// This code works out the distance, runs the pricing engine and returns ONLY
// what the customer should see: a range, a job type and a few notes. It never
// returns rates, hours or the cost breakdown, so those stay private.

import { CONFIG } from "./config.mjs";
import { estimate } from "./engine.mjs";
import { CITIES, OTHER_CANADA, UNITED_STATES, roadDistanceKm } from "./distance.mjs";

const HOME_SIZES = ["studio", "one_bed", "two_bed", "three_bed", "four_bed", "five_plus"];

const toInt = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v));

/**
 * @param {object} body  parsed JSON from the website:
 *   { fromCity, toCity, homeSize, moveDate, elevatorStatus,
 *     stairsFlights, packingRequired, heavyItems }
 * @returns {{ httpStatus: number, json: object }}
 */
export function handleEstimateRequest(body, cfg = CONFIG, opts = {}) {
  const givenKm = Number.isFinite(opts.distanceKm) && opts.distanceKm >= 0 ? Math.round(opts.distanceKm) : null;
  if (!body || typeof body !== "object") {
    return { httpStatus: 400, json: { status: "invalid", errors: ["Request body must be a JSON object"] } };
  }

  const errors = [];
  const isKnownPlace = (k) => k === OTHER_CANADA || k === UNITED_STATES || Boolean(CITIES[k]);
  if (!isKnownPlace(body.fromCity)) errors.push("fromCity is not recognised");
  if (!isKnownPlace(body.toCity)) errors.push("toCity is not recognised");
  if (!HOME_SIZES.includes(body.homeSize)) errors.push("homeSize is not recognised");
  const moveDate = body.moveDate ? String(body.moveDate) : null;
  if (moveDate && !/^\d{4}-\d{2}-\d{2}$/.test(moveDate)) errors.push("moveDate must look like 2026-06-30");
  if (errors.length) return { httpStatus: 400, json: { status: "invalid", errors } };

  // Cross-border: no instant range.
  if (body.fromCity === UNITED_STATES || body.toCity === UNITED_STATES) {
    return {
      httpStatus: 200,
      json: {
        status: "manual",
        reason: "cross_border",
        message: "Cross-border moves are quoted individually. Send us the details below and we will reply with a written quote.",
      },
    };
  }

  // A Canadian city that is not in the list: distance needs a real address.
  if (givenKm === null && (body.fromCity === OTHER_CANADA || body.toCity === OTHER_CANADA)) {
    return {
      httpStatus: 200,
      json: {
        status: "manual",
        reason: "address_needed",
        message: "For this route we need the exact addresses. Send us the details below and we will reply with a written quote.",
      },
    };
  }

  const distanceKm = givenKm !== null ? givenKm : roadDistanceKm(body.fromCity, body.toCity);

  if (distanceKm > (cfg.routing?.manualAboveKm ?? Infinity)) {
    return {
      httpStatus: 200,
      json: {
        status: "manual",
        reason: "very_long_distance",
        message: "This is a very long move, so we quote it individually. Send us the details below and we will reply with a written quote.",
      },
    };
  }

  const result = estimate(
    {
      homeSize: body.homeSize,
      distanceKm,
      stairsFlights: toInt(body.stairsFlights),
      elevatorStatus: body.elevatorStatus || "not_needed",
      packingRequired: body.packingRequired === true || body.packingRequired === "true",
      heavyItems: toInt(body.heavyItems),
      moveDate,
    },
    cfg
  );

  if (result.status === "invalid") {
    return { httpStatus: 400, json: { status: "invalid", errors: result.errors } };
  }
  if (result.status === "manual") {
    return { httpStatus: 200, json: { status: "manual", reason: result.reason, message: result.message } };
  }

  return {
    httpStatus: 200,
    json: {
      status: "ok",
      jobType: result.jobType,
      display: result.display,
      distanceKmApprox: Math.round(distanceKm / 5) * 5,
      distanceSource: givenKm !== null ? "address" : "city",
      notes: result.notes,
    },
  };
}
