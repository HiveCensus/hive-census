const $ = id => document.getElementById(id);

let selected = null;
let selectedMarker = null;

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

$("searchBtn").onclick = searchPlaces;

$("placeQuery").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    searchPlaces();
  }
});


/*
 * LOCALITY SEARCH
 */

async function searchPlaces() {
  const q = $("placeQuery").value.trim();

  if (q.length < 2) {
    return;
  }

  $("results").innerHTML =
    '<div class="muted">Searching…</div>';

  try {
    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=jsonv2" +
      "&addressdetails=1" +
      "&namedetails=1" +
      "&limit=8" +
      "&q=" +
      encodeURIComponent(q);

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en"
      }
    });

    if (!res.ok) {
      throw new Error("Geocoding request failed");
    }

    const data = await res.json();

    $("results").innerHTML = "";

    const places = data
      .map(normalizePlace)
      .filter(place => place !== null);

    places.forEach(place => {
      const div = document.createElement("div");

      div.className = "result";

      /*
       * User-facing format:
       *
       * Katowice, Silesian Voivodeship, Poland
       */

      div.textContent = place.displayLabel;

      div.onclick = () => choosePlace(place);

      $("results").appendChild(div);
    });

    if (!places.length) {
      $("results").innerHTML =
        '<div class="muted">No localities found.</div>';
    }

  } catch (e) {
    console.error(e);

    $("results").innerHTML =
      '<div class="muted">Search failed. Try again.</div>';
  }
}


/*
 * NORMALIZE GEOCODER RESULT
 *
 * Converts Nominatim data into the fields used by
 * Hive Census Protocol v1.0.
 */

function normalizePlace(p) {
  const a = p.address || {};

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

  /*
   * Census requires a locality.
   *
   * Search results that cannot provide a locality
   * and country are not offered for selection.
   */

  if (!city || !countryName || !countryCode) {
    return null;
  }

  /*
   * Human-readable administrative region.
   *
   * We prefer "state", which for Poland produces
   * values such as "Silesian Voivodeship".
   */

  const regionName =
    a.state ||
    a.region ||
    a.province ||
    a.state_district ||
    a.county ||
    null;

  /*
   * Nominatim may expose ISO 3166-2 codes under
   * different administrative levels, for example:
   *
   * ISO3166-2-lvl4
   * ISO3166-2-lvl5
   * ISO3166-2-lvl6
   *
   * We inspect all such fields instead of assuming
   * that every country uses the same admin level.
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
    displayLabel: displayParts.join(", ")
  };
}


/*
 * FIND ISO 3166-2 SUBDIVISION
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

  /*
   * Only accept a subdivision belonging to the
   * selected country.
   *
   * Example:
   *
   * country = PL
   * subdivision = PL-24
   */

  const valid = candidates.filter(candidate =>
    candidate.value.startsWith(countryCode + "-")
  );

  if (!valid.length) {
    return null;
  }

  /*
   * Prefer the highest-level administrative
   * subdivision available.
   *
   * Lower lvl number generally represents a
   * higher administrative level in Nominatim.
   */

  valid.sort((a, b) => {
    return extractAdminLevel(a.key) -
           extractAdminLevel(b.key);
  });

  return valid[0].value;
}


function extractAdminLevel(key) {
  const match = key.match(/lvl(\d+)/i);

  if (!match) {
    return 999;
  }

  return Number(match[1]);
}


/*
 * SELECT LOCALITY
 */

function choosePlace(place) {
  selected = place;

  $("selection").classList.remove("hidden");

  $("selection").innerHTML =
    `<strong>${escapeHtml(place.city)}</strong>` +
    `<br>` +
    `<span class="muted">` +
    `${escapeHtml(place.regionName || "No region")} · ` +
    `${escapeHtml(place.countryName)} · ` +
    `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}` +
    `</span>`;

  /*
   * Display exact Protocol v1 payload.
   */

  $("jsonPreview").textContent =
    JSON.stringify(censusPayload(), null, 2);

  /*
   * Update map.
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
    .bindPopup(escapeHtml(place.displayLabel))
    .openPopup();
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
 * Intentionally disabled in v0.3.
 *
 * No Hive transaction is broadcast by this build.
 */

$("publishBtn").onclick = () => {
  setStatus(
    "Publishing is intentionally disabled in v0.3 while Protocol v1.0 payloads are being tested.",
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
