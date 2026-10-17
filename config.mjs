// GTAH Movers: rate card and estimator settings.
//
// Source: GTAH Movers Plan and CRM Blueprint v2
//   section 7.2  Rate card
//   section 7.3  Estimating hours and adjustments
//   section 7.4  Long distance formula
//   Appendix B   Quote calculator logic
//
// Every number lives here, so rates can change without touching the engine.
// All amounts are CAD, before HST, unless stated.
//
// Lines marked ASSUMPTION are NOT defined in the blueprint. They are the
// choices needed to turn it into working code, and each needs owner sign-off.

export const CONFIG = {
  currency: "CAD",
  hstRate: 0.13,

  // 7.2 Crew rates per hour, and minimum billable hours per crew size.
  crewRates: { 2: 149, 3: 209, 4: 265 },
  minHours: { 2: 3, 3: 3, 4: 4 },

  // 7.2 Travel and truck fee: one hour at the crew rate, charged once.
  travelHours: 1,

  // 7.3 Home sizes. hours and crew are [low, high] ranges from the table.
  // corridorTier maps to the 7.2 corridor flat rates.
  homeSizes: {
    studio: {
      label: "Studio or bachelor",
      hours: [3, 4],
      crew: [2, 2],
      corridorTier: 1, // ASSUMPTION: studio uses tier 1 (blueprint lists "one bedroom")
    },
    one_bed: {
      label: "One bedroom",
      hours: [4, 5],
      crew: [2, 2],
      corridorTier: 1,
    },
    two_bed: {
      label: "Two bedroom",
      hours: [5, 7],
      crew: [2, 3],
      corridorTier: 2,
    },
    three_bed: {
      label: "Three bedroom",
      hours: [7, 10],
      crew: [3, 3],
      corridorTier: 2,
    },
    four_bed: {
      label: "Four bedroom",
      hours: [10, 14],
      crew: [3, 4],
      corridorTier: 3,
    },
    // 7.3: "Quote as a project". No instant estimate.
    five_plus: {
      label: "Five bedroom or larger",
      manual: true,
    },
  },

  // 7.2 Distance bands (Appendix B step 7) and corridor flat rates.
  distanceBands: { localMaxKm: 60, corridorMaxKm: 150 },
  corridorTiers: { 1: 1450, 2: 2150, 3: 3200 },

  // Appendix B step 4: access factor additions.
  access: {
    elevatorNone: 0.25,
    elevatorShared: 0.15,
    perExtraFlight: 0.1, // per flight beyond the first
    packing: 0.25,
  },

  // 7.2 Heavy or specialty items, per item.
  // The estimator uses the midpoint. Photos are needed before a firm price.
  heavyItem: { low: 175, high: 350 },

  // 7.2 Materials: cost plus 45 percent.
  materialsMarkup: 0.45,

  // 7.2 Peak surcharge: plus 10 percent on the last three and first two days
  // of the month, May through September.
  peak: { surcharge: 0.1, months: [5, 6, 7, 8, 9], lastDays: 3, firstDays: 2 },

  // Appendix B step 11: displayed range around the subtotal, and the
  // not-to-exceed figure (hourly quotes only).
  range: { low: 0.9, high: 1.1, notToExceed: 1.1 },

  // ASSUMPTION: round the displayed range to the nearest $10 (low down,
  // high up) so it does not look falsely precise. 0 turns rounding off.
  displayRoundTo: 10,

  // 7.4 Long distance formula (moves beyond corridorMaxKm).
  longDistance: {
    lineHaulPerKm: 2.5, // blueprint range 2.10 to 2.90; the worked example uses 2.50
    driverReturnRate: 42, // per hour
    fuelSurchargePct: 0.06, // blueprint range 3 to 8 percent; the worked example uses 6
    overnightCost: 210, // per driver per overnight
    contingencyPct: 0.14, // blueprint range 12 to 18 percent; the worked example uses 14

    // ASSUMPTION: the blueprint text says contingency applies "beyond 800 km",
    // but its Toronto to Ottawa example (450 km) includes 14 percent.
    // This follows the worked example. Set to 800 to follow the text.
    contingencyFromKm: 150,

    // ASSUMPTIONS below: the formula needs these inputs but the blueprint does
    // not say how to derive them. Chosen so the 450 km worked example comes out
    // at 5 return hours, 5 unload hours and 1 overnight.
    driveSpeedKmh: 90, // return hours = distance / speed
    unloadShareOfLoad: 0.7, // unload hours = load hours x 0.7
    maxDrivingHoursPerDay: 8, // overnights = ceil(distance / (speed x 8)), minimum 1

    // ASSUMPTION: only three_bed (180) comes from the blueprint's worked
    // example. The others are scaled to home size. Already includes the 45
    // percent markup.
    materialsByHomeSize: {
      studio: 75,
      one_bed: 95,
      two_bed: 125,
      three_bed: 180,
      four_bed: 255,
    },
  },
};
