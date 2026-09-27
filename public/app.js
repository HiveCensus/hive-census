const $ = id => document.getElementById(id);

let selected = null;
let selectedMarker = null;
let searchTimer = null;
let searchController = null;
let lastSearch = "";


/*
 * BASIC UI
 */

function setStatus(msg, bad = false) {
  $("status").textContent = msg;
  $("status").style.color = bad ? "#ff7288" : "#9da8b4";
}

function keychain() {
  return window.hive_keychain || null;
}

function checkKeychain() {
  const kc = keychain();

  if (!kc) {
    setStatus(
      "Hive Keychain was not detected in this browser.",
      true
    );
    return;
  }

  kc.requestHandshake(() => {
    setStatus("Hive Keychain detected.");
  });
}

$("handshakeBtn").onclick = checkKeychain;

$("connectBtn").onclick = () => {
  location.hash = "join";
  checkKeychain();
};


/*
 * LIVE SEARCH
 *
 * Search begins after 3 characters.
 * Requests are delayed by 500 ms so we do not
 * query the geocoder after every keystroke.
 */

$("placeQuery").addEventListener("input", () => {
  const q = $("placeQuery").value.trim();

  clearTimeout(searchTimer);

  /*
   * A new search means that the previous locality
   * is no longer considered selected.
   */

  clearSelection();

  if (q.length < 3) {
    $("results").innerHTML = "";
    return;
  }

  $("results").innerHTML =
    '<div class="muted">Searching…</div>';

  searchTimer = setTimeout(() => {
    searchPlaces(q);
  }, 500);
});


/*
 * Enter still allows the user to force an
 * immediate search.
 */

$("placeQuery").addEventListener("keydown", e => {
  if (e.key !== "Enter") {
    return;
  }

  e.preventDefault();

  clearTimeout(searchTimer);

  const q = $("placeQuery").value.trim();

  if (q.length >= 3) {
    searchPlaces(q);
  }
});


/*
 * Keep compatibility with the existing HTML.
 *
 * The Search button can be removed later.
 * For now, if it still exists, it performs an
 * immediate search.
 */

if ($("searchBtn")) {
  $("searchBtn").onclick = () => {
    clearTimeout(searchTimer);

    const q = $("placeQuery").value.trim();

    if (q.length >= 3) {
      searchPlaces(q);
    }
  };
}


/*
 * SEARCH
 */

async function searchPlaces(query) {
  const q = query.trim();

  if (q.length < 3) {
    return;
  }

  lastSearch = q;

  /*
   * Cancel an older request if the user has
   * already entered another search.
   */

  if (searchController) {
    searchController.abort();
  }

  searchController = new AbortController();

  $("results").innerHTML =
    '<div class="muted">Searching…</div>';

  try {
    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=jsonv2" +
      "&addressdetails=1" +
      "&namedetails=1" +
      "&extratags=1" +
      "&limit=20" +
      "&q=" +
      encodeURIComponent(q);

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en"
      },
      signal: searchController.signal
    });

    if (!res.ok) {
      throw new Error("Geocoding request failed");
    }

    const data = await res.json();

    /*
     * Ignore the result if the user has already
     * started another search.
     */

    if (lastSearch !== q) {
      return;
    }

    let places = data
      .map(p => normalizePlace(p, q))
      .filter(place => place !== null);

    /*
     * Remove duplicate representations of the same
     * Census locality.
     */

    places = deduplicatePlaces(places);

    /*
     * Rank results instead of aggressively filtering.
     *
     * This is important for:
     *
     * - alternative names;
     * - historical names;
     * - neighbourhood names;
     * - local names;
     * - transliterations;
     * - multilingual searches.
     */

    places.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.displayLabel.localeCompare(
        b.displayLabel,
        undefined,
        { sensitivity: "base" }
      );
    });

    renderResults(places);

  } catch (e) {
    if (e.name === "AbortError") {
      return;
    }

    console.error(e);

    $("results").innerHTML =
      '<div class="muted">Search failed. Try again.</div>';
  }
}


/*
 * NORMALIZE NOMINATIM RESULT
 */

function normalizePlace(p, query) {
  const a = p.address || {};

  /*
   * Census locality.
   *
   * We intentionally store a locality rather than
   * neighbourhood/suburb information.
   */

  const city =
    a.city ||
    a.town ||
    a.village ||
    a.municipality ||
    a.hamlet ||
    null;

  const countryName =
    a.country ||
    null;

  const countryCode =
    a.country_code
      ? a.country_code.toUpperCase()
      : null;

  if (!city || !countryName || !countryCode) {
    return null;
  }


  /*
   * Human-readable administrative region.
   */

  const regionName =
    a.state ||
    a.province ||
    a.region ||
    null;


  /*
   * ISO 3166-2 subdivision.
   */

  const regionCode =
    findSubdivisionCode(a, countryCode);


  const lat = Number(p.lat);
  const lon = Number(p.lon);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }


  /*
   * Collect names that may explain why Nominatim
   * returned this result.
   *
   * This can include:
   *
   * - official names;
   * - local names;
   * - alternative language names;
   * - old names;
   * - the actual OSM feature name.
   */

  const searchNames = collectSearchNames(p, city);

  const match = findBestMatch(
    query,
    city,
    searchNames
  );


  const displayParts = [
    city,
    regionName,
    countryName
  ].filter(Boolean);


  return {
    city,

    country: countryCode,
    countryName,

    region: regionCode,
    regionName,

    lat,
    lon,

    displayLabel: displayParts.join(", "),

    matchedName: match.name,
    matchType: match.type,
    score: match.score,

    osmType: p.type || null,
    osmClass: p.class || p.category || null
  };
}


/*
 * ALTERNATIVE / LOCAL / HISTORICAL NAMES
 */

function collectSearchNames(p, city) {
  const names = new Set();

  names.add(city);

  if (p.name) {
    names.add(p.name);
  }

  const namedetails = p.namedetails || {};

  for (const [key, value] of Object.entries(namedetails)) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      /*
       * Nominatim may return fields such as:
       *
       * name
       * name:en
       * name:pl
       * official_name
       * old_name
       * alt_name
       * short_name
       */

      if (
        key === "name" ||
        key.startsWith("name:") ||
        key.includes("official_name") ||
        key.includes("old_name") ||
        key.includes("alt_name") ||
        key.includes("short_name") ||
        key.includes("loc_name")
      ) {
        names.add(value.trim());
      }
    }
  }

  /*
   * Some useful names can also occur in extratags.
   */

  const extras = p.extratags || {};

  [
    "official_name",
    "old_name",
    "alt_name",
    "short_name",
    "loc_name"
  ].forEach(key => {
    const value = extras[key];

    if (typeof value === "string" && value.trim()) {
      value
        .split(";")
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(v => names.add(v));
    }
  });

  return [...names];
}


/*
 * SEARCH RANKING
 *
 * IMPORTANT:
 *
 * We rank results.
 * We do NOT aggressively discard distant matches.
 *
 * This lets searches for local, historical or
 * alternative names remain useful.
 */

function findBestMatch(query, city, names) {
  const q = normalizeText(query);
  const normalizedCity = normalizeText(city);

  let best = {
    name: city,
    type: "locality",
    score: similarityScore(q, normalizedCity)
  };


  /*
   * Exact Census locality name.
   */

  if (normalizedCity === q) {
    best.score = 1000;
    best.type = "exact locality";
  }


  /*
   * Census locality starts with the query.
   *
   * Example:
   *
   * Janów -> Janów Lubelski
   */

  else if (normalizedCity.startsWith(q)) {
    best.score = 900;
    best.type = "locality";
  }


  /*
   * Search all alternative names.
   */

  for (const name of names) {
    const n = normalizeText(name);

    let score = similarityScore(q, n);
    let type = "related name";

    if (n === q) {
      score = 850;
      type = "matching name";
    }

    else if (n.startsWith(q)) {
      score = 750;
      type = "related name";
    }

    else if (n.includes(q)) {
      score = 650;
      type = "related name";
    }

    if (score > best.score) {
      best = {
        name,
        type,
        score
      };
    }
  }

  return best;
}


/*
 * BASIC TEXT SIMILARITY
 */

function similarityScore(a, b) {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 100;
  }

  if (b.startsWith(a)) {
    return 90;
  }

  if (b.includes(a)) {
    return 75;
  }

  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);

  if (!maxLength) {
    return 0;
  }

  return Math.round(
    60 * (1 - distance / maxLength)
  );
}


function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] =
          matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}


/*
 * NORMALIZE TEXT FOR SEARCH
 *
 * Diacritics and case should not prevent a useful
 * match.
 *
 * Example:
 *
 * Janow -> Janów
 */

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}


/*
 * DEDUPLICATION
 */

function deduplicatePlaces(places) {
  const unique = new Map();

  for (const place of places) {
    const key = [
      normalizeText(place.city),
      place.region || normalizeText(place.regionName),
      place.country
    ].join("|");

    const existing = unique.get(key);

    /*
     * If Nominatim returned multiple representations
     * of the same locality, keep the one that best
     * matches the user's query.
     */

    if (
      !existing ||
      place.score > existing.score
    ) {
      unique.set(key, place);
    }
  }

  return [...unique.values()];
}


/*
 * RENDER SEARCH RESULTS
 */

function renderResults(places) {
  $("results").innerHTML = "";

  if (!places.length) {
    $("results").innerHTML =
      '<div class="muted">No localities found.</div>';
    return;
  }

  places.forEach(place => {
    const div = document.createElement("div");

    div.className = "result";


    const main = document.createElement("div");

    main.textContent = place.displayLabel;

    div.appendChild(main);


    /*
     * If the search matched another known name,
     * explain why this result appeared.
     *
     * Example:
     *
     * Kaufhaus
     * Ruda Śląska, Silesian Voivodeship, Poland
     *
     * Matched: Kaufhaus
     */

    if (
      place.matchedName &&
      normalizeText(place.matchedName) !==
        normalizeText(place.city)
    ) {
      const reason = document.createElement("div");

      reason.className = "muted";
      reason.style.fontSize = "0.82em";
      reason.style.marginTop = "6px";

      reason.textContent =
        `Matched: ${place.matchedName}`;

      div.appendChild(reason);
    }


    div.onclick = () => choosePlace(place);

    $("results").appendChild(div);
  });
}


/*
 * ISO 3166-2 SUBDIVISION
 */

function findSubdivisionCode(address, countryCode) {
  const candidates = [];

  for (const [key, value] of Object.entries(address)) {
    if (
      key.toUpperCase().startsWith("ISO3166-2-") &&
      typeof value === "string"
    ) {
      candidates.push({
        key,
        value: value.toUpperCase()
      });
    }
  }

  const valid = candidates.filter(candidate =>
    candidate.value.startsWith(countryCode + "-")
  );

  if (!valid.length) {
    return null;
  }

  valid.sort((a, b) => {
    return (
      extractAdminLevel(a.key) -
      extractAdminLevel(b.key)
    );
  });

  return valid[0].value;
}


function extractAdminLevel(key) {
  const match = key.match(/lvl(\d+)/i);

  return match
    ? Number(match[1])
    : 999;
}


/*
 * SELECT LOCALITY
 */

function choosePlace(place) {
  selected = place;

  $("selection").classList.remove("hidden");

  const locationParts = [
    place.city,
    place.regionName,
    place.countryName
  ].filter(Boolean);

  $("selection").innerHTML =
    `<strong>${escapeHtml(locationParts.join(", "))}</strong>` +
    `<br>` +
    `<span class="muted">` +
    `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}` +
    `</span>`;


  /*
   * Exact Hive Census Protocol v1.0 payload.
   */

  $("jsonPreview").textContent =
    JSON.stringify(censusPayload(), null, 2);


  /*
   * Map.
   */

  map.setView(
    [place.lat, place.lon],
    9
  );

  if (selectedMarker) {
    map.removeLayer(selectedMarker);
  }

  selectedMarker = L.marker([
    place.lat,
    place.lon
  ])
    .addTo(map)
    .bindPopup(
      escapeHtml(place.displayLabel)
    )
    .openPopup();
}


/*
 * CLEAR PREVIOUS SELECTION
 */

function clearSelection() {
  selected = null;

  if ($("selection")) {
    $("selection").classList.add("hidden");
    $("selection").innerHTML = "";
  }

  if ($("jsonPreview")) {
    $("jsonPreview").textContent =
      "Select a locality to preview the declaration.";
  }

  if (selectedMarker) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }
}


/*
 * HIVE CENSUS PROTOCOL v1.0
 */

function censusPayload() {
  if (!selected) {
    return null;
  }

  return {
    v: 1,
    action: "set",

    country: selected.country,
    country_name: selected.countryName,

    region: selected.region,
    region_name: selected.regionName,

    city: selected.city,

    lat: Number(selected.lat.toFixed(4)),
    lon: Number(selected.lon.toFixed(4))
  };
}


/*
 * PUBLISHING
 *
 * Still intentionally disabled.
 */

$("publishBtn").onclick = () => {
  setStatus(
    "Publishing is intentionally disabled while Hive Census v0.3.1 search and Protocol v1.0 payloads are being tested.",
    true
  );
};


/*
 * HTML SAFETY
 */

function escapeHtml(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[m]
  );
}


/*
 * MAP
 */

const map = L.map(
  "mapCanvas",
  {
    worldCopyJump: true,
    zoomControl: true
  }
).setView(
  [28, 12],
  2
);

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; OpenStreetMap contributors'
  }
).addTo(map);
