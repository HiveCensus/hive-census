
/**
 * Hive Census — Hive Profile Map
 * GeoNames Geocoder v0.2.4
 *
 * Conservative matching of public Hive profile.location.
 *
 * - Country-only values use capital-city proxies.
 * - Recognises country and selected administrative hints.
 * - Does not infer residence from country/region proxies.
 * - Avoids guessing between similarly named places.
 * - Does not write to D1.
 */

const VERSION = "0.2.4";
const GEONAMES_URL = "https://secure.geonames.org/searchJSON";
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
  ["AR", "Argentina", "Buenos Aires", ["argentinia"]],
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
  ["SR", "Suriname", "Paramaribo", []],
  ["NP", "Nepal", "Kathmandu", []],

  // Additional European countries
  ["CY", "Cyprus", "Nicosia", ["kypros", "kibris"]],
  ["EE", "Estonia", "Tallinn", ["eesti"]],
  ["LV", "Latvia", "Riga", []],
  ["LT", "Lithuania", "Vilnius", []],
  ["SI", "Slovenia", "Ljubljana", []],
  ["HR", "Croatia", "Zagreb", []],
  ["RS", "Serbia", "Belgrade", []],
  ["BA", "Bosnia and Herzegovina", "Sarajevo",
    ["bosnia"]],
  ["ME", "Montenegro", "Podgorica", []],
  ["MK", "North Macedonia", "Skopje",
    ["macedonia"]],
  ["AL", "Albania", "Tirana", []],
  ["BG", "Bulgaria", "Sofia", []],
  ["MD", "Moldova", "Chisinau", []],
  ["BY", "Belarus", "Minsk", []],
  ["LU", "Luxembourg", "Luxembourg", []],
  ["MT", "Malta", "Valletta", []],
  ["IS", "Iceland", "Reykjavik", []],
  ["GE", "Georgia", "Tbilisi", []],
  ["AM", "Armenia", "Yerevan", []],
  ["AZ", "Azerbaijan", "Baku", []],

  // Additional countries in Asia
  ["CN", "China", "Beijing", []],
  ["TW", "Taiwan", "Taipei", []],
  ["LK", "Sri Lanka", "Sri Jayawardenepura Kotte", []],
  ["MM", "Myanmar", "Naypyidaw", ["burma"]],
  ["KH", "Cambodia", "Phnom Penh", []],
  ["LA", "Laos", "Vientiane", []],
  ["MN", "Mongolia", "Ulaanbaatar", []],
  ["KZ", "Kazakhstan", "Astana", []],
  ["UZ", "Uzbekistan", "Tashkent", []],
  ["KG", "Kyrgyzstan", "Bishkek", []],
  ["TJ", "Tajikistan", "Dushanbe", []],
  ["TM", "Turkmenistan", "Ashgabat", []],
  ["AF", "Afghanistan", "Kabul", []],
  ["IR", "Iran", "Tehran", []],
  ["IQ", "Iraq", "Baghdad", []],
  ["SA", "Saudi Arabia", "Riyadh", []],
  ["AE", "United Arab Emirates", "Abu Dhabi", ["uae"]],
  ["QA", "Qatar", "Doha", []],
  ["KW", "Kuwait", "Kuwait City", []],
  ["OM", "Oman", "Muscat", []],
  ["BH", "Bahrain", "Manama", []],
  ["JO", "Jordan", "Amman", []],
  ["LB", "Lebanon", "Beirut", []],
  ["IL", "Israel", "Jerusalem", []],

  // Additional African countries
  ["MA", "Morocco", "Rabat", []],
  ["DZ", "Algeria", "Algiers", []],
  ["TN", "Tunisia", "Tunis", []],
  ["LY", "Libya", "Tripoli", []],
  ["SD", "Sudan", "Khartoum", []],
  ["ET", "Ethiopia", "Addis Ababa", []],
  ["UG", "Uganda", "Kampala", []],
  ["TZ", "Tanzania", "Dodoma", []],
  ["RW", "Rwanda", "Kigali", []],
  ["SN", "Senegal", "Dakar", []],
  ["CI", "Ivory Coast", "Yamoussoukro",
    ["cote d ivoire", "côte d'ivoire"]],
  ["CM", "Cameroon", "Yaounde", []],
  ["ZM", "Zambia", "Lusaka", []],
  ["ZW", "Zimbabwe", "Harare", []],
  ["BW", "Botswana", "Gaborone", []],
  ["NA", "Namibia", "Windhoek", []],
  ["MG", "Madagascar", "Antananarivo", []],

  // Additional American and Caribbean countries
  ["UY", "Uruguay", "Montevideo", []],
  ["PY", "Paraguay", "Asuncion", []],
  ["BO", "Bolivia", "Sucre", []],
  ["EC", "Ecuador", "Quito", []],
  ["GY", "Guyana", "Georgetown", []],
  ["CR", "Costa Rica", "San Jose", []],
  ["PA", "Panama", "Panama City", []],
  ["GT", "Guatemala", "Guatemala City", []],
  ["HN", "Honduras", "Tegucigalpa", []],
  ["SV", "El Salvador", "San Salvador", []],
  ["NI", "Nicaragua", "Managua", []],
  ["CU", "Cuba", "Havana", []],
  ["DO", "Dominican Republic", "Santo Domingo", []],
  ["HT", "Haiti", "Port-au-Prince", []],
  ["JM", "Jamaica", "Kingston", []],
  ["TT", "Trinidad and Tobago", "Port of Spain", []],

  // Oceania
  ["FJ", "Fiji", "Suva", []],
  ["PG", "Papua New Guinea", "Port Moresby", []],
  ["WS", "Samoa", "Apia", []],
  ["TO", "Tonga", "Nuku'alofa", []],
  ["VU", "Vanuatu", "Port Vila", []]
];

const ADMIN_HINTS = [
  ["US", "CA", ["california", "ca"]],
  ["US", "AZ", ["arizona", "az"]],
  ["US", "SC", ["south carolina"]],
  ["US", "NY", ["new york"]],
  ["US", "TX", ["texas"]],
  ["US", "FL", ["florida"]],
  ["US", "WA", ["washington state"]],
  ["US", "CO", ["colorado"]],
  ["US", "IL", ["illinois"]],
  ["US", "NV", ["nevada"]],
  ["US", "OR", ["oregon"]],
  ["CA", "ON", ["ontario"]],
  ["CA", "QC", ["quebec", "québec"]],
  ["CA", "BC", ["british columbia"]],
  ["CA", "AB", ["alberta"]]
];

const NON_GEOGRAPHIC = new Set([
  "earth", "world", "the world", "whole world",
  "planet", "planet earth", "cool planet",
  "mars", "everywhere", "anywhere",
  "somewhere", "nowhere", "near you", "home",
  "online", "internet", "metaverse",
  "universe", "galaxy", "the galaxy",
  "steemit", "international", "digital nomad",
  "virtual world", "crypto",
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
  if (typeof value !== "string") return "";

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

const adminAliases = new Map();

for (const [country, admin, aliases] of ADMIN_HINTS) {
  for (const alias of aliases) {
    const key = normalizeText(alias);
    if (!adminAliases.has(key)) adminAliases.set(key, []);
    adminAliases.get(key).push({ country, admin });
  }
}

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

  const standaloneCountry = countryAliases.get(normalized);

  if (standaloneCountry) {
    return {
      query,
      placeQuery: standaloneCountry.capital,
      countryHint: standaloneCountry.code,
      adminHint: null,
      countryOnly: true,
      country: standaloneCountry
    };
  }

  let placeQuery = query;
  let countryHint = null;
  let adminHint = null;

  const parts = query.split(",").map(x => x.trim()).filter(Boolean);

  if (parts.length >= 2) {
    const last = normalizeText(parts[parts.length - 1]);
    const country = countryAliases.get(last);

    if (country) {
      countryHint = country.code;
      placeQuery = parts.slice(0, -1).join(", ");
    }
  }

  if (!countryHint) {
    for (const [alias, country] of sortedCountryAliases) {
      if (normalized.endsWith(" " + alias)) {
        const words = normalized.split(" ");
        const count = alias.split(" ").length;
        const remaining = words.slice(0, -count).join(" ");

        if (remaining) {
          countryHint = country.code;
          placeQuery = remaining;
          break;
        }
      }
    }
  }

  const placeParts = placeQuery
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  if (placeParts.length >= 2) {
    const last = normalizeText(placeParts[placeParts.length - 1]);
    const hints = adminAliases.get(last) || [];
    const matching = countryHint
      ? hints.filter(x => x.country === countryHint)
      : hints;

    if (matching.length === 1) {
      countryHint = matching[0].country;
      adminHint = matching[0].admin;
      placeQuery = placeParts.slice(0, -1).join(", ");
    }
  }

  return {
    query,
    placeQuery,
    countryHint,
    adminHint,
    countryOnly: false,
    country: null
  };
}

function cleanPlaceName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocationType(item) {
  if (item.fcode === "PCLI") return "country_proxy";
  if (item.fcl === "P") return "locality";
  if (item.fcl === "A") return "region_proxy";
  return null;
}

function unresolved(status, reason, count = 0) {
  return {
    status,
    location_type: null,
    country: null,
    country_name: null,
    region: null,
    region_name: null,
    city: null,
    lat: null,
    lon: null,
    confidence: null,
    source: "geonames_v4",
    reason,
    candidates_considered: count
  };
}

function validCandidate(item) {
  if (!item || !getLocationType(item)) return false;

  if (
    item.lat === null || item.lat === undefined ||
    item.lng === null || item.lng === undefined
  ) return false;

  const lat = Number(item.lat);
  const lon = Number(item.lng);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180
  );
}

function exactNameMatch(expected, item) {
  const name = normalizeText(expected);

  return [
    item.toponymName,
    item.name,
    item.asciiName
  ].some(x => x && normalizeText(x) === name);
}

function priority(item) {
  const priorities = {
    PPLC: 100,
    PPLA: 95,
    PPLA2: 90,
    PPLA3: 85,
    PPL: 80,
    PPLX: 65,
    ADM1: 60
  };

  return priorities[item.fcode] ??
    (item.fcl === "P" ? 70 :
      item.fcl === "A" ? 50 : 0);
}

function scoreCandidate(item, parsed) {
  if (!validCandidate(item)) return null;

  if (
    parsed.countryHint &&
    item.countryCode !== parsed.countryHint
  ) return null;

  if (
    parsed.adminHint &&
    String(item.adminCode1 || "").toUpperCase() !==
      parsed.adminHint
  ) return null;

  if (parsed.countryOnly && item.fcl !== "P") return null;

  if (
    !parsed.countryOnly &&
    getLocationType(item) === "country_proxy"
  ) return null;

  const expected = parsed.countryOnly
    ? parsed.country.capital
    : cleanPlaceName(parsed.placeQuery);

  if (!exactNameMatch(expected, item)) return null;

  return {
    item,
    priority: priority(item),
    population: Math.max(0, Number(item.population) || 0)
  };
}

function normalizeCandidate(item, parsed) {
  return {
    location_type: parsed.countryOnly
      ? "country_proxy"
      : getLocationType(item),
    country: item.countryCode || null,
    country_name: item.countryName || null,
    region: parsed.countryOnly ? null : item.adminCode1 || null,
    region_name: parsed.countryOnly ? null : item.adminName1 || null,
    city: item.toponymName || item.name || null,
    lat: Number(item.lat),
    lon: Number(item.lng),
    source: "geonames_v4"
  };
}

export function evaluateGeocoderResults(rawLocation, candidates) {
  const parsed = parseLocation(rawLocation);

  if (isNonGeographicLocation(parsed.query)) {
    return unresolved("rejected", "non_geographic_location");
  }

  if (!Array.isArray(candidates) || !candidates.length) {
    return unresolved("ambiguous", "no_candidates");
  }

  const evaluated = candidates
    .map(item => scoreCandidate(item, parsed))
    .filter(Boolean)
    .sort((a, b) =>
      b.priority - a.priority ||
      b.population - a.population
    );

  if (!evaluated.length) {
    return unresolved(
      "ambiguous",
      "no_matching_candidates",
      candidates.length
    );
  }

  const best = evaluated[0];
  const second = evaluated[1];

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
    return unresolved(
      "ambiguous",
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

export async function geocodeLocation(rawLocation, username) {
  const parsed = parseLocation(rawLocation);

  if (isNonGeographicLocation(parsed.query)) {
    return unresolved("rejected", "non_geographic_location");
  }

  if (typeof username !== "string" || !username.trim()) {
    throw new Error("GEONAMES_USERNAME is not configured");
  }

  const url = new URL(GEONAMES_URL);
  url.searchParams.set(
    "q",
    cleanPlaceName(parsed.placeQuery)
  );
  url.searchParams.set("maxRows", String(MAX_RESULTS));
  url.searchParams.set("username", username);
  url.searchParams.set("style", "FULL");

  if (parsed.countryHint) {
    url.searchParams.set("country", parsed.countryHint);
  }

  if (parsed.countryOnly) {
    url.searchParams.set("featureClass", "P");
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`GeoNames HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.status) {
    throw new Error(
      `GeoNames API: ${data.status.message || "unknown error"}`
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
