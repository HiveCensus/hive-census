
/**
 * Hive Profile Map — GeoNames Geocoder
 * Version 0.2.0
 *
 * External geographic search and conservative
 * candidate evaluation.
 *
 * Does not write to D1.
 */

const VERSION = "0.2.0";

const GEONAMES_URL =
  "https://secure.geonames.org/searchJSON";

const MIN_CONFIDENCE = 0.85;
const MAX_RESULTS = 10;
const REQUEST_TIMEOUT_MS = 12000;

const NON_GEOGRAPHIC_PATTERNS = [
  /\bdigital nomad\b/i,
  /\beverywhere\b/i,
  /\banywhere\b/i,
  /\bplanet earth\b/i,
  /\bcrypto(?:tab)?\b/i,
  /\bmetaverse\b/i,
  /\bvirtual world\b/i
];

const COUNTRY_ALIASES = {
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  "united kingdom": "GB",
  england: "GB",
  bangladesh: "BD",
  india: "IN",
  indonesia: "ID",
  pakistan: "PK",
  philippines: "PH",
  germany: "DE",
  deutschland: "DE",
  poland: "PL",
  polska: "PL",
  ireland: "IE",
  nigeria: "NG",
  canada: "CA",
  australia: "AU",
  "south africa": "ZA",
  china: "CN",
  france: "FR",
  japan: "JP",
  brazil: "BR",
  brasil: "BR",
  venezuela: "VE",
  malaysia: "MY",
  singapore: "SG"
};

export function getGeocoderVersion() {
  return VERSION;
}

export function normalizeGeocoderQuery(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .trim()
    .replace(/_/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isNonGeographicLocation(value) {
  const normalized =
    normalizeGeocoderQuery(value);

  return (
    !normalized ||
    NON_GEOGRAPHIC_PATTERNS.some(
      pattern => pattern.test(normalized)
    )
  );
}

function getCountryHint(query) {
  const parts = query
    .split(",")
    .map(part => normalizeText(part))
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const last = parts[parts.length - 1];

  return COUNTRY_ALIASES[last] || null;
}

function getPlaceQuery(query) {
  const parts = query
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return query;
  }

  const hint = getCountryHint(query);

  if (!hint) {
    return query;
  }

  return parts
    .slice(0, -1)
    .join(", ");
}

function getLocationType(item) {
  if (item.fcode === "PCLI") {
    return "country_proxy";
  }

  if (
    item.fcl === "A" &&
    item.fcode !== "PCLI"
  ) {
    return "region_proxy";
  }

  if (item.fcl === "P") {
    return "locality";
  }

  return null;
}

function ambiguous(reason, count = 0) {
  return {
    status: "ambiguous",
    location_type: null,
    country: null,
    country_name: null,
    region: null,
    region_name: null,
    city: null,
    lat: null,
    lon: null,
    confidence: null,
    source: "geonames_v1",
    reason,
    candidates_considered: count
  };
}

function rejected(reason) {
  return {
    ...ambiguous(reason),
    status: "rejected"
  };
}

function normalizeCandidate(item) {
  const type = getLocationType(item);

  return {
    location_type: type,
    country: item.countryCode || null,
    country_name: item.countryName || null,
    region: item.adminCode1 || null,
    region_name: item.adminName1 || null,
    city:
      type === "locality"
        ? item.toponymName || item.name || null
        : type === "region_proxy"
          ? item.toponymName || item.name || null
          : null,
    lat: Number(item.lat),
    lon: Number(item.lng),
    source: "geonames_v1"
  };
}

function scoreCandidate(
  query,
  item,
  countryHint
) {
  const name = normalizeText(
    item.toponymName || item.name
  );

  const alternative = normalizeText(
    item.name
  );

  const expected = normalizeText(query);

  if (
    countryHint &&
    item.countryCode !== countryHint
  ) {
    return 0;
  }

  if (
    name === expected ||
    alternative === expected
  ) {
    return 1;
  }

  if (
    expected.includes(name) &&
    name.length >= 4
  ) {
    return 0.65;
  }

  return 0;
}

export function evaluateGeocoderResults(
  rawLocation,
  candidates
) {
  const query =
    normalizeGeocoderQuery(rawLocation);

  if (isNonGeographicLocation(query)) {
    return rejected("non_geographic_location");
  }

  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return ambiguous("no_candidates");
  }

  const countryHint =
    getCountryHint(query);

  const placeQuery =
    getPlaceQuery(query);

  const evaluated = candidates
    .filter(item => {
      if (!item || !getLocationType(item)) {
        return false;
      }

      const lat = Number(item.lat);
      const lon = Number(item.lng);

      return (
        item.lat !== null &&
        item.lat !== undefined &&
        item.lng !== null &&
        item.lng !== undefined &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
      );
    })
    .map(item => ({
      item,
      score: scoreCandidate(
        placeQuery,
        item,
        countryHint
      )
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!evaluated.length) {
    return ambiguous(
      "no_matching_candidates",
      candidates.length
    );
  }

  const best = evaluated[0];
  const second = evaluated[1];

  if (best.score < MIN_CONFIDENCE) {
    return ambiguous(
      "low_confidence",
      candidates.length
    );
  }

  if (
    second &&
    best.score - second.score < 0.15
  ) {
    return ambiguous(
      "multiple_similar_candidates",
      candidates.length
    );
  }

  return {
    status: "matched",
    ...normalizeCandidate(best.item),
    confidence: best.score,
    reason: "automatic_geonames_match",
    candidates_considered:
      candidates.length
  };
}

export async function geocodeLocation(
  rawLocation,
  username
) {
  const query =
    normalizeGeocoderQuery(rawLocation);

  if (isNonGeographicLocation(query)) {
    return rejected("non_geographic_location");
  }

  if (
    typeof username !== "string" ||
    !username.trim()
  ) {
    throw new Error(
      "GEONAMES_USERNAME is not configured"
    );
  }

  const countryHint =
    getCountryHint(query);

  const placeQuery =
    getPlaceQuery(query);

  const url = new URL(GEONAMES_URL);

  url.searchParams.set(
    "q",
    placeQuery
  );

  url.searchParams.set(
    "maxRows",
    String(MAX_RESULTS)
  );

  url.searchParams.set(
    "username",
    username
  );

  url.searchParams.set(
    "style",
    "FULL"
  );

  if (countryHint) {
    url.searchParams.set(
      "country",
      countryHint
    );
  }

  const response = await fetch(
    url.toString(),
    {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(
        REQUEST_TIMEOUT_MS
      )
    }
  );

  if (!response.ok) {
    throw new Error(
      `GeoNames HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (data.status) {
    throw new Error(
      `GeoNames API: ${data.status.message || "unknown error"}`
    );
  }

  return evaluateGeocoderResults(
    query,
    data.geonames || []
  );
}
