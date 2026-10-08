
/**
 * Hive Census — Hive Profile Map
 * GeoNames Geocoder v0.2.1
 *
 * Conservative geographic matching for public
 * Hive profile.location values.
 *
 * Features:
 * - Normalizes common separators and punctuation.
 * - Recognizes "city, country" and "city country".
 * - Handles country-only values as country proxies.
 * - Rejects clearly non-geographic descriptions.
 * - Avoids automatically resolving ambiguous places.
 * - Does not write to D1.
 *
 * Country and region proxies are representative
 * coordinates, not evidence of actual residence.
 */

const VERSION = "0.2.1";

const GEONAMES_URL =
  "https://secure.geonames.org/searchJSON";

const MIN_CONFIDENCE = 0.85;
const MAX_RESULTS = 10;
const REQUEST_TIMEOUT_MS = 12000;

const COUNTRY_DATA = [
  ["PL", "Poland", ["polska"]],
  ["BD", "Bangladesh", ["bd"]],
  ["IN", "India", []],
  ["US", "United States", [
    "usa", "us", "united states of america"
  ]],
  ["CA", "Canada", []],
  ["VE", "Venezuela", []],
  ["ID", "Indonesia", []],
  ["NG", "Nigeria", []],
  ["PK", "Pakistan", []],
  ["DE", "Germany", ["deutschland"]],
  ["MY", "Malaysia", []],
  ["AU", "Australia", []],
  ["MU", "Mauritius", []],
  ["ZA", "South Africa", []],
  ["GB", "United Kingdom", [
    "uk", "great britain", "britain"
  ]],
  ["SG", "Singapore", []],
  ["FR", "France", []],
  ["ES", "Spain", ["espana", "españa"]],
  ["IT", "Italy", ["italia"]],
  ["BR", "Brazil", ["brasil"]],
  ["AR", "Argentina", []],
  ["MX", "Mexico", ["méxico"]],
  ["JP", "Japan", []],
  ["KR", "South Korea", ["republic of korea"]],
  ["PH", "Philippines", []],
  ["TH", "Thailand", []],
  ["VN", "Vietnam", []],
  ["TR", "Türkiye", ["turkey", "turkiye"]],
  ["UA", "Ukraine", []],
  ["NL", "Netherlands", ["holland"]],
  ["BE", "Belgium", []],
  ["CH", "Switzerland", []],
  ["AT", "Austria", []],
  ["SE", "Sweden", []],
  ["NO", "Norway", []],
  ["DK", "Denmark", []],
  ["FI", "Finland", []],
  ["IE", "Ireland", []],
  ["PT", "Portugal", []],
  ["CZ", "Czechia", ["czech republic"]],
  ["SK", "Slovakia", []],
  ["HU", "Hungary", []],
  ["RO", "Romania", []],
  ["GR", "Greece", []],
  ["EG", "Egypt", []],
  ["KE", "Kenya", []],
  ["GH", "Ghana", []],
  ["CO", "Colombia", []],
  ["PE", "Peru", []],
  ["CL", "Chile", []],
  ["NZ", "New Zealand", []],
  ["SR", "Suriname", []]
];

const NON_GEOGRAPHIC = new Set([
  "earth",
  "world",
  "the world",
  "whole world",
  "planet",
  "planet earth",
  "cool planet",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "near you",
  "online",
  "internet",
  "metaverse",
  "universe",
  "galaxy",
  "the galaxy",
  "steemit",
  "international",
  "digital nomad",
  "virtual world",
  "crypto",
  "btc earn cryptotab browser"
]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
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
    .replace(/[.,;\s]+$/g, "")
    .slice(0, 500);
}

const countryAliases = new Map();

for (const [code, name, aliases] of COUNTRY_DATA) {
  for (const alias of [name, ...aliases]) {
    countryAliases.set(
      normalizeText(alias),
      { code, name }
    );
  }
}

function isNonGeographicLocation(value) {
  const normalized = normalizeText(value);

  return (
    !normalized ||
    NON_GEOGRAPHIC.has(normalized)
  );
}

/**
 * Resolve a country suffix only when it is
 * explicitly recognized in our country dictionary.
 *
 * Examples:
 * "Lagos, Nigeria" -> Lagos / NG
 * "stockholm sweden" -> stockholm / SE
 * "Durban city South Africa" -> Durban city / ZA
 */
function parseLocation(value) {
  const query = normalizeGeocoderQuery(value);
  const normalized = normalizeText(query);

  const standaloneCountry =
    countryAliases.get(normalized);

  if (standaloneCountry) {
    return {
      query,
      placeQuery: query,
      countryHint: standaloneCountry.code,
      countryOnly: true
    };
  }

  const commaParts = query
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (commaParts.length >= 2) {
    const lastPart = normalizeText(
      commaParts[commaParts.length - 1]
    );

    const country = countryAliases.get(lastPart);

    if (country) {
      return {
        query,
        placeQuery: commaParts
          .slice(0, -1)
          .join(", "),
        countryHint: country.code,
        countryOnly: false
      };
    }
  }

  const countryNames = [...countryAliases.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  for (const [alias, country] of countryNames) {
    if (
      normalized.endsWith(` ${alias}`) &&
      normalized.length > alias.length + 1
    ) {
      const words = normalized.split(" ");
      const aliasWords = alias.split(" ");

      const placeWords = words.slice(
        0,
        words.length - aliasWords.length
      );

      if (placeWords.length) {
        return {
          query,
          placeQuery: placeWords.join(" "),
          countryHint: country.code,
          countryOnly: false
        };
      }
    }
  }

  return {
    query,
    placeQuery: query,
    countryHint: null,
    countryOnly: false
  };
}

function cleanPlaceName(value) {
  return String(value || "")
    .replace(/\bcity\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocationType(item) {
  if (item.fcode === "PCLI") {
    return "country_proxy";
  }

  if (item.fcl === "A") {
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
    source: "geonames_v2",
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
    source: "geonames_v2"
  };
}

function scoreCandidate(
  expectedName,
  item,
  countryHint,
  countryOnly
) {
  const type = getLocationType(item);

  if (!type) {
    return 0;
  }

  if (
    countryHint &&
    item.countryCode !== countryHint
  ) {
    return 0;
  }

  if (countryOnly && type !== "country_proxy") {
    return 0;
  }

  if (!countryOnly && type === "country_proxy") {
    return 0;
  }

  const expected = normalizeText(
    cleanPlaceName(expectedName)
  );

  const names = [
    item.toponymName,
    item.name
  ]
    .filter(Boolean)
    .map(normalizeText);

  if (names.includes(expected)) {
    return 1;
  }

  return 0;
}

export function evaluateGeocoderResults(
  rawLocation,
  candidates
) {
  const parsed = parseLocation(rawLocation);

  if (isNonGeographicLocation(parsed.query)) {
    return rejected("non_geographic_location");
  }

  if (
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return ambiguous("no_candidates");
  }

  const expectedName = parsed.countryOnly
    ? parsed.query
    : parsed.placeQuery;

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
        expectedName,
        item,
        parsed.countryHint,
        parsed.countryOnly
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
  const parsed = parseLocation(rawLocation);

  if (isNonGeographicLocation(parsed.query)) {
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

  const url = new URL(GEONAMES_URL);

  url.searchParams.set(
    "q",
    parsed.countryOnly
      ? parsed.query
      : cleanPlaceName(parsed.placeQuery)
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

  if (parsed.countryHint) {
    url.searchParams.set(
      "country",
      parsed.countryHint
    );
  }

  if (parsed.countryOnly) {
    url.searchParams.set(
      "featureCode",
      "PCLI"
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
      `GeoNames API: ${
        data.status.message || "unknown error"
      }`
    );
  }

  return evaluateGeocoderResults(
    parsed.query,
    data.geonames || []
  );
}

export function getGeocoderVersion() {
  return VERSION;
}
