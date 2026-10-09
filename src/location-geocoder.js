
/**
 * Hive Census — Hive Profile Map
 * GeoNames Geocoder v0.2.5
 *
 * Conservative matching of public Hive profile.location.
 *
 * - Country-only values use capital-city proxies.
 * - Recognised state/province-only values use regional
 *   capital-city proxies.
 * - Region proxies require an exact capital match,
 *   country match and administrative code match.
 * - Recognises selected spelling variants.
 * - Does not infer residence from proxies.
 * - Avoids guessing between similarly named places.
 * - Does not write to D1.
 */

const VERSION = "0.2.5";
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
  ["AR", "Argentina", "Buenos Aires",
    ["argentinia"]],
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
  ["NL", "Netherlands", "Amsterdam",
    ["holland"]],
  ["BE", "Belgium", "Brussels", []],
  ["CH", "Switzerland", "Bern", []],
  ["AT", "Austria", "Vienna", []],
  ["SE", "Sweden", "Stockholm", []],
  ["NO", "Norway", "Oslo", []],
  ["DK", "Denmark", "Copenhagen", []],
  ["FI", "Finland", "Helsinki", []],
  ["IE", "Ireland", "Dublin", []],
  ["PT", "Portugal", "Lisbon", []],
  ["CZ", "Czechia", "Prague",
    ["czech republic"]],
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

  // Europe
  ["CY", "Cyprus", "Nicosia",
    ["kypros", "kibris"]],
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

  // Asia
  ["CN", "China", "Beijing", []],
  ["TW", "Taiwan", "Taipei", []],
  ["LK", "Sri Lanka",
    "Sri Jayawardenepura Kotte", []],
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
  ["AE", "United Arab Emirates", "Abu Dhabi",
    ["uae"]],
  ["QA", "Qatar", "Doha", []],
  ["KW", "Kuwait", "Kuwait City", []],
  ["OM", "Oman", "Muscat", []],
  ["BH", "Bahrain", "Manama", []],
  ["JO", "Jordan", "Amman", []],
  ["LB", "Lebanon", "Beirut", []],
  ["IL", "Israel", "Jerusalem", []],

  // Africa
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

  // Americas
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
  ["DO", "Dominican Republic",
    "Santo Domingo", []],
  ["HT", "Haiti", "Port-au-Prince", []],
  ["JM", "Jamaica", "Kingston", []],
  ["TT", "Trinidad and Tobago",
    "Port of Spain", []],

  // Oceania
  ["FJ", "Fiji", "Suva", []],
  ["PG", "Papua New Guinea",
    "Port Moresby", []],
  ["WS", "Samoa", "Apia", []],
  ["TO", "Tonga", "Nuku'alofa", []],
  ["VU", "Vanuatu", "Port Vila", []]
];

/**
 * Region entries:
 * [country, adminCode1, regionName, capital, aliases]
 *
 * Capitals are representative points only.
 *
 * Administrative codes are GeoNames adminCode1
 * values, not necessarily ISO 3166-2 suffixes.
 *
 * Avoid automatic handling of regions whose
 * capital arrangements are uncertain or disputed.
 */
const REGION_DATA = [
  // United States
  ["US", "AL", "Alabama", "Montgomery", []],
  ["US", "AK", "Alaska", "Juneau", []],
  ["US", "AZ", "Arizona", "Phoenix", []],
  ["US", "AR", "Arkansas", "Little Rock", []],
  ["US", "CA", "California", "Sacramento", []],
  ["US", "CO", "Colorado", "Denver", []],
  ["US", "CT", "Connecticut", "Hartford", []],
  ["US", "DE", "Delaware", "Dover", []],
  ["US", "FL", "Florida", "Tallahassee", []],
  ["US", "GA", "Georgia", "Atlanta", []],
  ["US", "HI", "Hawaii", "Honolulu", []],
  ["US", "ID", "Idaho", "Boise", []],
  ["US", "IL", "Illinois", "Springfield", []],
  ["US", "IN", "Indiana", "Indianapolis", []],
  ["US", "IA", "Iowa", "Des Moines", []],
  ["US", "KS", "Kansas", "Topeka", []],
  ["US", "KY", "Kentucky", "Frankfort", []],
  ["US", "LA", "Louisiana", "Baton Rouge", []],
  ["US", "ME", "Maine", "Augusta", []],
  ["US", "MD", "Maryland", "Annapolis", []],
  ["US", "MA", "Massachusetts", "Boston", []],
  ["US", "MI", "Michigan", "Lansing", []],
  ["US", "MN", "Minnesota", "Saint Paul",
    ["st paul"]],
  ["US", "MS", "Mississippi", "Jackson", []],
  ["US", "MO", "Missouri", "Jefferson City", []],
  ["US", "MT", "Montana", "Helena", []],
  ["US", "NE", "Nebraska", "Lincoln", []],
  ["US", "NV", "Nevada", "Carson City", []],
  ["US", "NH", "New Hampshire", "Concord", []],
  ["US", "NJ", "New Jersey", "Trenton", []],
  ["US", "NM", "New Mexico", "Santa Fe", []],
  ["US", "NY", "New York", "Albany", []],
  ["US", "NC", "North Carolina", "Raleigh", []],
  ["US", "ND", "North Dakota", "Bismarck", []],
  ["US", "OH", "Ohio", "Columbus", []],
  ["US", "OK", "Oklahoma", "Oklahoma City", []],
  ["US", "OR", "Oregon", "Salem", []],
  ["US", "PA", "Pennsylvania", "Harrisburg", []],
  ["US", "RI", "Rhode Island", "Providence", []],
  ["US", "SC", "South Carolina", "Columbia", []],
  ["US", "SD", "South Dakota", "Pierre", []],
  ["US", "TN", "Tennessee", "Nashville", []],
  ["US", "TX", "Texas", "Austin", []],
  ["US", "UT", "Utah", "Salt Lake City", []],
  ["US", "VT", "Vermont", "Montpelier", []],
  ["US", "VA", "Virginia", "Richmond", []],
  ["US", "WA", "Washington", "Olympia",
    ["washington state"]],
  ["US", "WV", "West Virginia", "Charleston", []],
  ["US", "WI", "Wisconsin", "Madison", []],
  ["US", "WY", "Wyoming", "Cheyenne", []],

  // Canada
  ["CA", "AB", "Alberta", "Edmonton", []],
  ["CA", "BC", "British Columbia", "Victoria", []],
  ["CA", "MB", "Manitoba", "Winnipeg", []],
  ["CA", "NB", "New Brunswick", "Fredericton", []],
  ["CA", "NL", "Newfoundland and Labrador",
    "St. John's", ["newfoundland"]],
  ["CA", "NS", "Nova Scotia", "Halifax", []],
  ["CA", "ON", "Ontario", "Toronto", []],
  ["CA", "PE", "Prince Edward Island",
    "Charlottetown", []],
  ["CA", "QC", "Quebec", "Québec",
    ["québec"]],
  ["CA", "SK", "Saskatchewan", "Regina", []],
  ["CA", "NT", "Northwest Territories",
    "Yellowknife", []],
  ["CA", "NU", "Nunavut", "Iqaluit", []],
  ["CA", "YT", "Yukon", "Whitehorse", []],

  // India — selected states
  // GeoNames numeric adminCode1 identifiers.
  ["IN", "02", "Andhra Pradesh", "Amaravati",
    ["andhrapradesh"]],
  ["IN", "03", "Assam", "Dispur", []],
  ["IN", "34", "Bihar", "Patna", []],
  ["IN", "37", "Chhattisgarh", "Raipur",
    ["chattisgarh"]],
  ["IN", "33", "Goa", "Panaji", []],
  ["IN", "09", "Gujarat", "Gandhinagar", []],
  ["IN", "10", "Haryana", "Chandigarh", []],
  ["IN", "11", "Himachal Pradesh", "Shimla", []],
  ["IN", "38", "Jharkhand", "Ranchi", []],
  ["IN", "19", "Karnataka", "Bengaluru",
    ["karnatak"]],
  ["IN", "13", "Kerala", "Thiruvananthapuram", []],
  ["IN", "35", "Madhya Pradesh", "Bhopal", []],
  ["IN", "16", "Maharashtra", "Mumbai", []],
  ["IN", "17", "Manipur", "Imphal", []],
  ["IN", "18", "Meghalaya", "Shillong", []],
  ["IN", "31", "Mizoram", "Aizawl", []],
  ["IN", "20", "Nagaland", "Kohima", []],
  ["IN", "21", "Odisha", "Bhubaneswar",
    ["orissa"]],
  ["IN", "23", "Punjab", "Chandigarh", []],
  ["IN", "24", "Rajasthan", "Jaipur", []],
  ["IN", "29", "Sikkim", "Gangtok", []],
  ["IN", "25", "Tamil Nadu", "Chennai",
    ["tamilnadu"]],
  ["IN", "40", "Telangana", "Hyderabad", []],
  ["IN", "26", "Tripura", "Agartala", []],
  ["IN", "36", "Uttar Pradesh", "Lucknow", []],
  ["IN", "39", "Uttarakhand", "Dehradun", []],
  ["IN", "28", "West Bengal", "Kolkata", []]
];

/**
 * Administrative hints for city + state searches.
 * These are deliberately separate from region-only
 * matching.
 */
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

const regionAliases = new Map();

for (
  const [country, admin, name, capital, aliases]
  of REGION_DATA
) {
  const region = {
    country,
    admin,
    name,
    capital
  };

  for (const alias of [name, ...aliases]) {
    const key = normalizeText(alias);

    if (!regionAliases.has(key)) {
      regionAliases.set(key, []);
    }

    regionAliases.get(key).push(region);
  }
}

const adminAliases = new Map();

for (const [country, admin, aliases] of ADMIN_HINTS) {
  for (const alias of aliases) {
    const key = normalizeText(alias);

    if (!adminAliases.has(key)) {
      adminAliases.set(key, []);
    }

    adminAliases.get(key).push({
      country,
      admin
    });
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

function findRegion(value, countryHint = null) {
  const normalized = normalizeText(value);

  if (!normalized) return null;

  const matches = regionAliases.get(normalized) || [];

  const filtered = countryHint
    ? matches.filter(
        item => item.country === countryHint
      )
    : matches;

  return filtered.length === 1
    ? filtered[0]
    : null;
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
      adminHint: null,
      countryOnly: true,
      country: standaloneCountry,
      regionOnly: false,
      region: null
    };
  }

  let placeQuery = query;
  let countryHint = null;
  let adminHint = null;

  const parts = query
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const last = normalizeText(
      parts[parts.length - 1]
    );

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

        const remaining = words
          .slice(0, -count)
          .join(" ");

        if (remaining) {
          countryHint = country.code;
          placeQuery = remaining;
          break;
        }
      }
    }
  }

  /**
   * Region-only recognition is performed before
   * treating the final comma-separated component
   * as a city administrative hint.
   *
   * Example:
   * Andhrapradesh,India
   * -> Andhra Pradesh
   * -> Amaravati (region_proxy)
   */
  const standaloneRegion = findRegion(
    placeQuery,
    countryHint
  );

  if (standaloneRegion) {
    return {
      query,
      placeQuery: standaloneRegion.capital,
      countryHint: standaloneRegion.country,
      adminHint: standaloneRegion.admin,
      countryOnly: false,
      country: null,
      regionOnly: true,
      region: standaloneRegion
    };
  }

  const placeParts = placeQuery
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  if (placeParts.length >= 2) {
    const last = normalizeText(
      placeParts[placeParts.length - 1]
    );

    const hints = adminAliases.get(last) || [];

    const matching = countryHint
      ? hints.filter(
          x => x.country === countryHint
        )
      : hints;

    if (matching.length === 1) {
      countryHint = matching[0].country;
      adminHint = matching[0].admin;

      placeQuery = placeParts
        .slice(0, -1)
        .join(", ");
    }
  }

  return {
    query,
    placeQuery,
    countryHint,
    adminHint,
    countryOnly: false,
    country: null,
    regionOnly: false,
    region: null
  };
}

function cleanPlaceName(value) {
  return String(value || "")
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

function exactNameMatch(expected, item) {
  const name = normalizeText(expected);

  return [
    item.toponymName,
    item.name,
    item.asciiName
  ].some(
    x => x && normalizeText(x) === name
  );
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
    (
      item.fcl === "P"
        ? 70
        : item.fcl === "A"
          ? 50
          : 0
    );
}

function scoreCandidate(item, parsed) {
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
    parsed.adminHint &&
    String(item.adminCode1 || "").toUpperCase() !==
      String(parsed.adminHint).toUpperCase()
  ) {
    return null;
  }

  if (parsed.countryOnly && item.fcl !== "P") {
    return null;
  }

  if (parsed.regionOnly) {
    // Regional proxies must point to an actual
    // populated place, not the geographic centre
    // of an administrative boundary.
    if (item.fcl !== "P") {
      return null;
    }

    // The result must represent the configured
    // capital of the recognised region.
    if (
      !exactNameMatch(
        parsed.region.capital,
        item
      )
    ) {
      return null;
    }

    return {
      item,
      priority: priority(item),
      population: Math.max(
        0,
        Number(item.population) || 0
      )
    };
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
    priority: priority(item),
    population: Math.max(
      0,
      Number(item.population) || 0
    )
  };
}

function normalizeCandidate(item, parsed) {
  if (parsed.regionOnly) {
    return {
      location_type: "region_proxy",
      country: parsed.region.country,
      country_name: item.countryName || null,
      region: parsed.region.admin,
      region_name: parsed.region.name,
      city: item.toponymName ||
        item.name ||
        parsed.region.capital,
      lat: Number(item.lat),
      lon: Number(item.lng),
      source: "geonames_v4"
    };
  }

  return {
    location_type: parsed.countryOnly
      ? "country_proxy"
      : getLocationType(item),
    country: item.countryCode || null,
    country_name: item.countryName || null,
    region: parsed.countryOnly
      ? null
      : item.adminCode1 || null,
    region_name: parsed.countryOnly
      ? null
      : item.adminName1 || null,
    city: item.toponymName ||
      item.name ||
      null,
    lat: Number(item.lat),
    lon: Number(item.lng),
    source: "geonames_v4"
  };
}

export function evaluateGeocoderResults(
  rawLocation,
  candidates
) {
  const parsed = parseLocation(rawLocation);

  if (isNonGeographicLocation(parsed.query)) {
    return unresolved(
      "rejected",
      "non_geographic_location"
    );
  }

  if (
    !Array.isArray(candidates) ||
    !candidates.length
  ) {
    return unresolved(
      "ambiguous",
      "no_candidates"
    );
  }

  const evaluated = candidates
    .map(
      item => scoreCandidate(item, parsed)
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
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

  let reason = "automatic_geonames_match";

  if (parsed.countryOnly) {
    reason = "country_capital_proxy";
  } else if (parsed.regionOnly) {
    reason = "region_capital_proxy";
  }

  return {
    status: "matched",
    ...normalizeCandidate(best.item, parsed),
    confidence: 1,
    reason,
    candidates_considered: candidates.length
  };
}

export async function geocodeLocation(
  rawLocation,
  username
) {
  const parsed = parseLocation(rawLocation);

  if (isNonGeographicLocation(parsed.query)) {
    return unresolved(
      "rejected",
      "non_geographic_location"
    );
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
    cleanPlaceName(parsed.placeQuery)
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

  if (parsed.countryOnly || parsed.regionOnly) {
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
