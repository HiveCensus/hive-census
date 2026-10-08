
/**
 * Hive Census — Hive Profile Map
 * Location classifier v0.1.0
 *
 * Classifies public Hive profile.location values.
 *
 * Important:
 * - A country is represented at its capital, not treated as
 *   evidence that the account holder lives in that city.
 * - Regions use representative coordinates.
 * - Ambiguous and non-geographic values are not geocoded.
 * - This module does not modify the original profile.location.
 * - No external geocoding requests are performed.
 */

const COUNTRY_DATA = [
  // [ISO 3166-1 alpha-2, country, capital, latitude, longitude, aliases]
  ["PL", "Poland", "Warsaw", 52.2297, 21.0122, ["polska"]],
  ["BD", "Bangladesh", "Dhaka", 23.8103, 90.4125, ["bd"]],
  ["IN", "India", "New Delhi", 28.6139, 77.2090, []],
  ["US", "United States", "Washington, D.C.", 38.9072, -77.0369,
    ["usa", "united states of america", "u.s.a.", "us"]],
  ["CA", "Canada", "Ottawa", 45.4215, -75.6972, []],
  ["VE", "Venezuela", "Caracas", 10.4806, -66.9036, []],
  ["ID", "Indonesia", "Jakarta", -6.2088, 106.8456, []],
  ["NG", "Nigeria", "Abuja", 9.0765, 7.3986, []],
  ["PK", "Pakistan", "Islamabad", 33.6844, 73.0479, []],
  ["DE", "Germany", "Berlin", 52.5200, 13.4050, ["deutschland"]],
  ["MY", "Malaysia", "Kuala Lumpur", 3.1390, 101.6869, []],
  ["AU", "Australia", "Canberra", -35.2809, 149.1300, []],
  ["MU", "Mauritius", "Port Louis", -20.1609, 57.5012, []],
  ["ZA", "South Africa", "Pretoria", -25.7479, 28.2293, []],
  ["GB", "United Kingdom", "London", 51.5074, -0.1278,
    ["uk", "great britain", "britain"]],
  ["SG", "Singapore", "Singapore", 1.3521, 103.8198, []],
  ["FR", "France", "Paris", 48.8566, 2.3522, []],
  ["ES", "Spain", "Madrid", 40.4168, -3.7038, ["espana", "españa"]],
  ["IT", "Italy", "Rome", 41.9028, 12.4964, ["italia"]],
  ["BR", "Brazil", "Brasilia", -15.7939, -47.8828, ["brasil"]],
  ["AR", "Argentina", "Buenos Aires", -34.6037, -58.3816, []],
  ["MX", "Mexico", "Mexico City", 19.4326, -99.1332, ["méxico"]],
  ["JP", "Japan", "Tokyo", 35.6762, 139.6503, []],
  ["KR", "South Korea", "Seoul", 37.5665, 126.9780,
    ["republic of korea"]],
  ["PH", "Philippines", "Manila", 14.5995, 120.9842, []],
  ["TH", "Thailand", "Bangkok", 13.7563, 100.5018, []],
  ["VN", "Vietnam", "Hanoi", 21.0278, 105.8342, []],
  ["TR", "Türkiye", "Ankara", 39.9334, 32.8597,
    ["turkey", "turkiye"]],
  ["UA", "Ukraine", "Kyiv", 50.4501, 30.5234, []],
  ["NL", "Netherlands", "Amsterdam", 52.3676, 4.9041,
    ["holland"]],
  ["BE", "Belgium", "Brussels", 50.8503, 4.3517, []],
  ["CH", "Switzerland", "Bern", 46.9480, 7.4474, []],
  ["AT", "Austria", "Vienna", 48.2082, 16.3738, []],
  ["SE", "Sweden", "Stockholm", 59.3293, 18.0686, []],
  ["NO", "Norway", "Oslo", 59.9139, 10.7522, []],
  ["DK", "Denmark", "Copenhagen", 55.6761, 12.5683, []],
  ["FI", "Finland", "Helsinki", 60.1699, 24.9384, []],
  ["IE", "Ireland", "Dublin", 53.3498, -6.2603, []],
  ["PT", "Portugal", "Lisbon", 38.7223, -9.1393, []],
  ["CZ", "Czechia", "Prague", 50.0755, 14.4378,
    ["czech republic"]],
  ["SK", "Slovakia", "Bratislava", 48.1486, 17.1077, []],
  ["HU", "Hungary", "Budapest", 47.4979, 19.0402, []],
  ["RO", "Romania", "Bucharest", 44.4268, 26.1025, []],
  ["GR", "Greece", "Athens", 37.9838, 23.7275, []],
  ["EG", "Egypt", "Cairo", 30.0444, 31.2357, []],
  ["KE", "Kenya", "Nairobi", -1.2921, 36.8219, []],
  ["GH", "Ghana", "Accra", 5.6037, -0.1870, []],
  ["CO", "Colombia", "Bogota", 4.7110, -74.0721, []],
  ["PE", "Peru", "Lima", -12.0464, -77.0428, []],
  ["CL", "Chile", "Santiago", -33.4489, -70.6693, []],
  ["NZ", "New Zealand", "Wellington", -41.2866, 174.7756, []]
];

const LOCALITIES = [
  ["Dhaka", "BD", null, 23.8103, 90.4125, ["dhaka, bangladesh"]],
  ["Berlin", "DE", null, 52.5200, 13.4050, ["berlin, germany"]],
  ["Lagos", "NG", "Lagos State", 6.5244, 3.3792,
    ["lagos, nigeria"]],
  ["London", "GB", "England", 51.5074, -0.1278,
    ["london, uk", "london, england", "london, united kingdom"]],
  ["San Francisco", "US", "California", 37.7749, -122.4194,
    ["san francisco, ca", "san francisco, california"]],
  ["Warsaw", "PL", "Masovian", 52.2297, 21.0122,
    ["warszawa", "warsaw, poland", "warszawa, polska"]],
  ["New Delhi", "IN", "Delhi", 28.6139, 77.2090,
    ["new delhi, india"]],
  ["Jakarta", "ID", null, -6.2088, 106.8456,
    ["jakarta, indonesia"]],
  ["Abuja", "NG", null, 9.0765, 7.3986, ["abuja, nigeria"]],
  ["Ottawa", "CA", "Ontario", 45.4215, -75.6972,
    ["ottawa, canada"]],
  ["Washington, D.C.", "US", "District of Columbia",
    38.9072, -77.0369,
    ["washington dc", "washington d.c.", "washington, dc"]],
  ["Paris", "FR", null, 48.8566, 2.3522, ["paris, france"]],
  ["Tokyo", "JP", null, 35.6762, 139.6503, ["tokyo, japan"]],
  ["Singapore", "SG", null, 1.3521, 103.8198,
    ["singapore city"]]
];

const REGIONS = [
  ["Aceh", "ID", "Indonesia", "Banda Aceh",
    5.5483, 95.3238,
    ["aceh-indonesia", "aceh. indonesia", "aceh, indonesia"]],
  ["Silesia", "PL", "Poland", "Katowice",
    50.2649, 19.0238,
    ["śląsk", "slask", "silesia, poland"]],
  ["California", "US", "United States", "Sacramento",
    38.5816, -121.4944,
    ["california, usa", "california, us"]]
];

const NON_GEOGRAPHIC = new Set([
  "earth",
  "world",
  "the world",
  "planet",
  "planet earth",
  "everywhere",
  "anywhere",
  "somewhere",
  "nowhere",
  "online",
  "internet",
  "metaverse",
  "universe",
  "crypto",
  "btc earn cryptotab browser"
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function matched({
  locationType,
  country,
  countryName,
  region = null,
  regionName = null,
  city,
  lat,
  lon,
  confidence,
  source
}) {
  return {
    status: "matched",
    location_type: locationType,
    country,
    country_name: countryName,
    region,
    region_name: regionName,
    city,
    lat,
    lon,
    confidence,
    source
  };
}

function unresolved(status, source) {
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
    source
  };
}

const countriesByCode = new Map(
  COUNTRY_DATA.map(row => [row[0], row])
);

const countryAliases = new Map();

for (const row of COUNTRY_DATA) {
  const [code, name, , , , aliases] = row;
  for (const alias of [name, ...aliases]) {
    countryAliases.set(normalize(alias), code);
  }
}

const localityAliases = new Map();

for (const row of LOCALITIES) {
  const [name, code, region, lat, lon, aliases] = row;
  const country = countriesByCode.get(code);
  for (const alias of [name, ...aliases]) {
    localityAliases.set(normalize(alias), {
      name, code, region, lat, lon,
      countryName: country?.[1] ?? null
    });
  }
}

const regionAliases = new Map();

for (const row of REGIONS) {
  const [name, code, countryName, representativeCity,
    lat, lon, aliases] = row;

  for (const alias of [name, ...aliases]) {
    regionAliases.set(normalize(alias), {
      name, code, countryName, representativeCity, lat, lon
    });
  }
}

/**
 * Classify a public profile location.
 *
 * Return values:
 *   matched   — safe dictionary-based match
 *   ambiguous — requires review or a later geocoder
 *   rejected  — explicitly non-geographic text
 *
 * Bare Singapore is deliberately treated as a country proxy,
 * while "Singapore City" is a locality.
 */
export function classifyLocation(rawLocation) {
  const key = normalize(rawLocation);

  if (!key) {
    return unresolved("rejected", "empty_location");
  }

  if (NON_GEOGRAPHIC.has(key)) {
    return unresolved("rejected", "non_geographic_dictionary");
  }

  const countryCode = countryAliases.get(key);

  if (countryCode) {
    const country = countriesByCode.get(countryCode);
    const [code, name, capital, lat, lon] = country;

    return matched({
      locationType: "country_proxy",
      country: code,
      countryName: name,
      city: capital,
      lat,
      lon,
      confidence: 1,
      source: "country_dictionary_v1"
    });
  }

  const region = regionAliases.get(key);

  if (region) {
    return matched({
      locationType: "region_proxy",
      country: region.code,
      countryName: region.countryName,
      region: region.name,
      regionName: region.name,
      city: region.representativeCity,
      lat: region.lat,
      lon: region.lon,
      confidence: 1,
      source: "region_dictionary_v1"
    });
  }

  const locality = localityAliases.get(key);

  if (locality) {
    return matched({
      locationType: "locality",
      country: locality.code,
      countryName: locality.countryName,
      region: locality.region,
      regionName: locality.region,
      city: locality.name,
      lat: locality.lat,
      lon: locality.lon,
      confidence: 1,
      source: "locality_dictionary_v1"
    });
  }

  return unresolved("ambiguous", "dictionary_no_match");
}

export function getClassifierVersion() {
  return "0.1.0";
}
