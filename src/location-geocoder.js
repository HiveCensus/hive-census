
/**
 * Hive Census — Hive Profile Map
 * GeoNames Geocoder v0.2.2
 *
 * Conservative geographic matching for public
 * Hive profile.location values.
 *
 * Country-only values use capital-city coordinates
 * as country proxies, never as evidence of residence.
 *
 * Does not write to D1.
 */

const VERSION = "0.2.2";

const GEONAMES_URL =
  "https://secure.geonames.org/searchJSON";

const MAX_RESULTS = 10;
const REQUEST_TIMEOUT_MS = 12000;

const COUNTRY_DATA = [
  ["PL", "Poland", "Warsaw", ["polska"]],
  ["BD", "Bangladesh", "Dhaka", ["bd"]],
  ["IN", "India", "New Delhi", []],
  ["US", "United States", "Washington, D.C.",
    ["usa", "us", "united states of america"]],
  ["CA", "Canada", "Ottawa", []],
  ["VE", "Venezuela", "Caracas", []],
  ["ID", "Indonesia", "Jakarta", []],
  ["NG", "Nigeria", "Abuja", []],
  ["PK", "Pakistan", "Islamabad", []],
  ["DE", "Germany", "Berlin", ["deutschland"]],
  ["MY", "Malaysia", "Kuala Lumpur", []],
  ["AU", "Australia", "Canberra", []],
  ["MU", "Mauritius", "Port Louis", []],
  ["ZA", "South Africa", "Pretoria", []],
  ["GB", "United Kingdom", "London",
    ["uk", "great britain", "britain"]],
  ["SG", "Singapore", "Singapore", []],
  ["FR", "France", "Paris", []],
  ["ES", "Spain", "Madrid", ["espana", "españa"]],
  ["IT", "Italy", "Rome", ["italia"]],
  ["BR", "Brazil", "Brasília", ["brasil"]],
  ["AR", "Argentina", "Buenos Aires", []],
  ["MX", "Mexico", "Mexico City", ["méxico"]],
  ["JP", "Japan", "Tokyo", []],
  ["KR", "South Korea", "Seoul",
    ["republic of korea"]],
  ["PH", "Philippines", "Manila", []],
  ["TH", "Thailand", "Bangkok", []],
  ["VN", "Vietnam", "Hanoi", []],
  ["TR", "Türkiye", "Ankara",
    ["turkey", "turkiye"]],
  ["UA", "Ukraine", "Kyiv", []],
  ["NL", "Netherlands", "Amsterdam", ["holland"]],
  ["BE", "Belgium", "Brussels", []],
  ["CH", "Switzerland", "Bern", []],
  ["AT", "Austria", "Vienna", []],
  ["SE", "Sweden", "Stockholm", []],
  ["NO", "Norway", "Oslo", []],
  ["DK", "Denmark", "Copenhagen", []],
  ["FI", "Finland", "Helsinki", []],
  ["IE", "Ireland", "Dublin", []],
  ["PT", "Portugal", "Lisbon", []],
  ["CZ", "Czechia", "Prague", ["czech republic"]],
  ["SK", "Slovakia", "Bratislava", []],
  ["HU", "Hungary", "Budapest", []],
  ["RO", "Romania", "Bucharest", []],
  ["GR", "Greece", "Athens", []],
  ["EG", "Egypt", "Cairo", []],
  ["KE", "Kenya", "Nairobi", []],
  ["GH", "Ghana", "Accra", []],
  ["CO", "Colombia", "Bogotá", []],
  ["PE", "Peru", "Lima", []],
  ["CL", "Chile", "Santiago", []],
  ["NZ", "New Zealand", "Wellington", []],
  ["SR", "Suriname", "Paramaribo", []]
];

const NON_GEOGRAPHIC = new Set([
  "earth",
  "world",
  "the world",
  "whole world",
  "planet",
  "planet earth",
  "cool planet",
  "mars",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "near you",
  "home",
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
  "btc earn cryptotab browser",
  "i live on planet hive",
  "steemit victims defence league"
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

for (const [code, name, capital, aliases] of COUNTRY_DATA) {
  const country = { code, name, capital };

  for (const alias of [name, ...aliases]) {
    countryAliases.set(normalizeText(alias), country);
  }
}

const sortedCountryAliases =
  [...countryAliases.entries()]
    .sort((a, b) => b[0].length - a[0].length);

function isNonGeographicLocation(value) {
  const normalized = normalizeText(value);

  return (
    !normalized ||
    NON_GEOGRAPHIC.has(normalized) ||
    /^@[\w.-]+$/.test(String(value).trim())
  );
}

function parseLocation(value) {
  const query = normalizeGeocoderQuery(value);
  const normalized = normalizeText(query);

  const standaloneCountry =
    countryAliases.get(normalized);

  if (standaloneCountry) {
    return {
      query,
      placeQuery: standaloneCountry.capital,
      countryHint: standaloneCountry.code,
      countryOnly: true,
      country: standaloneCountry
    };
  }

  const parts = query
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const last = normalizeText(parts[parts.length - 1]);
    const country = countryAliases.get(last);

    if (country) {
      return {
        query,
        placeQuery: parts.slice(0, -1).join(", "),
        countryHint: country.code,
        countryOnly: false,
        country: null
      };
    }
  }

  for (const [alias, country] of sortedCountryAliases) {
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
          countryOnly: false,
          country: null
        };
      }
    }
  }

  return {
    query,
    placeQuery: query,
    countryHint: null,
    countryOnly: false,
    country: null
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

  if (item.fcl === "P") {
    return "locality";
  }

  if (item.fcl === "A") {
    return "region_proxy";
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
    source: "geonames_v3",
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

function validCandidate(item) {
  if (!item || !getLocationType(item)) {
    return false;
  }

  if (
    item.lat === null ||
    item.lat === undefined ||
    item.lng === null ||
    item.lng === undefined
  ) {
    return false;
  }

  const lat = Number(item.lat);
  const lon = Number(item.lng);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function getCandidateNames(item) {
  return [
    item.toponymName,
    item.name,
    item.asciiName
  ]
    .filter(Boolean)
    .map(normalizeText);
}

function exactNameMatch(expected, item) {
  return getCandidateNames(item).includes(
    normalizeText(expected)
  );
}

function getPriority(item, countryOnly) {
  if (countryOnly) {
    if (item.fcode === "PPLC") return 100;
    if (item.fcode === "PPL") return 80;
    if (item.fcl === "P") return 70;
    return 0;
  }

  if (item.fcode === "PPLC") return 100;
  if (item.fcode === "PPLA") return 95;
  if (item.fcode === "PPLA2") return 90;
  if (item.fcode === "PPLA3") return 85;
  if (item.fcode === "PPL") return 80;
  if (item.fcl === "P") return 70;
  if (item.fcode === "ADM1") return 60;
  if (item.fcl === "A") return 50;

  return 0;
}

function normalizeCandidate(item, parsed) {
  const type = parsed.countryOnly
    ? "country_proxy"
    : getLocationType(item);

  return {
    location_type: type,
    country: item.countryCode || null,
    country_name: item.countryName || null,
    region: parsed.countryOnly
      ? null
      : item.adminCode1 || null,
    region_name: parsed.countryOnly
      ? null
      : item.adminName1 || null,
    city: item.toponymName || item.name || null,
    lat: Number(item.lat),
    lon: Number(item.lng),
    source: "geonames_v3"
  };
}

function candidateScore(item, parsed) {
  if (!validCandidate(item)) {
    return null;
  }

  if (
    parsed.countryHint &&
    item.countryCode !== parsed.countryHint
  ) {
    return null;
  }

  if (
    parsed.countryOnly &&
    item.fcl !== "P"
  ) {
    return null;
  }

  if (
    !parsed.countryOnly &&
    getLocationType(item) === "country_proxy"
  ) {
    return null;
  }

  const expected = parsed.countryOnly
    ? parsed.country.capital
    : cleanPlaceName(parsed.placeQuery);

  if (!exactNameMatch(expected, item)) {
    return null;
  }

  return {
    item,
    priority: getPriority(item, parsed.countryOnly),
    population: Math.max(
      0,
      Number(item.population) || 0
    )
  };
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

  const evaluated = candidates
    .map(item => candidateScore(item, parsed))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      return b.population - a.population;
    });

  if (!evaluated.length) {
    return ambiguous(
      "no_matching_candidates",
      candidates.length
    );
  }

  const best = evaluated[0];
  const second = evaluated[1];

  /*
   * If two places share the same name,
   * type priority alone is insufficient
   * when both are populated places of
   * comparable importance.
   */
  if (
    second &&
    best.priority === second.priority &&
    (
      best.population === second.population ||
      (
        best.population > 0 &&
        second.population > 0 &&
        second.population / best.population > 0.5
      )
    )
  ) {
    return ambiguous(
      "multiple_similar_candidates",
      candidates.length
    );
  }

  return {
    status: "matched",
    ...normalizeCandidate(best.item, parsed),
    confidence: 1,
    reason: parsed.countryOnly
      ? "country_capital_proxy"
      : "automatic_geonames_match",
    candidates_considered: candidates.length
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
      ? parsed.country.capital
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
      "featureClass",
      "P"
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
