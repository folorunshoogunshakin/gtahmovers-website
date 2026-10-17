// Built-in distance lookup between known cities.
//
// This is the FALLBACK. In production a Google Routes lookup will return real
// driving distances for any address. This table keeps the estimator working
// without a Google account, and stays as the backup if that lookup fails.
//
// Method: straight-line (great circle) distance between city centres, times a
// road factor. ASSUMPTION: 1.2. Accurate to roughly 10 percent on most Ontario
// routes. It under-reads routes that go around Lake Ontario (for example
// Toronto to Niagara Falls), but those stay in the same distance band, so the
// price band does not change. Real addresses will be exact once Google Routes
// is connected.

export const ROAD_FACTOR = 1.2;

export const OTHER_CANADA = "other_canada";
export const UNITED_STATES = "united_states";

// Keys are what the website sends. Labels are what customers see.
export const CITIES = {
  // GTA and Hamilton
  toronto: { label: "Toronto", lat: 43.6532, lon: -79.3832 },
  mississauga: { label: "Mississauga", lat: 43.589, lon: -79.6441 },
  brampton: { label: "Brampton", lat: 43.7315, lon: -79.7624 },
  vaughan: { label: "Vaughan", lat: 43.8372, lon: -79.5083 },
  markham: { label: "Markham", lat: 43.8561, lon: -79.337 },
  richmond_hill: { label: "Richmond Hill", lat: 43.8828, lon: -79.4403 },
  oakville: { label: "Oakville", lat: 43.4675, lon: -79.6877 },
  burlington: { label: "Burlington", lat: 43.3255, lon: -79.799 },
  hamilton: { label: "Hamilton", lat: 43.2557, lon: -79.8711 },
  pickering: { label: "Pickering", lat: 43.8384, lon: -79.0868 },
  ajax: { label: "Ajax", lat: 43.8509, lon: -79.0204 },
  whitby: { label: "Whitby", lat: 43.8975, lon: -78.9429 },
  oshawa: { label: "Oshawa", lat: 43.8971, lon: -78.8658 },
  // Elsewhere in Ontario
  barrie: { label: "Barrie", lat: 44.3894, lon: -79.6903 },
  guelph: { label: "Guelph", lat: 43.5448, lon: -80.2482 },
  kitchener: { label: "Kitchener", lat: 43.4516, lon: -80.4925 },
  waterloo: { label: "Waterloo", lat: 43.4643, lon: -80.5204 },
  cambridge: { label: "Cambridge", lat: 43.3616, lon: -80.3144 },
  st_catharines: { label: "St. Catharines", lat: 43.1594, lon: -79.2469 },
  niagara_falls: { label: "Niagara Falls", lat: 43.0896, lon: -79.0849 },
  london: { label: "London", lat: 42.9849, lon: -81.2453 },
  windsor: { label: "Windsor", lat: 42.3149, lon: -83.0364 },
  peterborough: { label: "Peterborough", lat: 44.3091, lon: -78.3197 },
  kingston: { label: "Kingston", lat: 44.2312, lon: -76.486 },
  ottawa: { label: "Ottawa", lat: 45.4215, lon: -75.6972 },
  // Elsewhere in Canada
  montreal: { label: "Montreal", lat: 45.5017, lon: -73.5673 },
};

const toRad = (deg) => (deg * Math.PI) / 180;

export function greatCircleKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Approximate driving distance in km between two city keys.
 * Returns null if either key is not in the table.
 */
export function roadDistanceKm(fromKey, toKey) {
  const a = CITIES[fromKey];
  const b = CITIES[toKey];
  if (!a || !b) return null;
  if (fromKey === toKey) return 0;
  return Math.round(greatCircleKm(a, b) * ROAD_FACTOR);
}
