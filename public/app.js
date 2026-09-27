const $ = id => document.getElementById(id);

let selected = null;
let selectedMarker = null;
let censusMarkers = [];
let searchTimer = null;
let searchController = null;
let lastSearch = "";
let publishing = false;

const CENSUS_VERSION = "0.6.0";
const PROTOCOL_VERSION = 1;
const CUSTOM_JSON_ID = "hive_census";
const CENSUS_API = "/api/census";


/*
 * BASIC UI
 */

function setStatus(msg, bad = false) {
  const status = $("status");

  if (!status) return;

  status.textContent = msg;
  status.style.color = bad ? "#ff7288" : "#9da8b4";
}


/*
 * KEYCHAIN
 */

function inspectKeychain() {
  const hiveKeychain = window.hive_keychain;
  const hive = window.hive;

  return {
    hiveKeychainExists: !!hiveKeychain,
    hiveExists: !!hive,

    hiveKeychainHandshake:
      !!hiveKeychain &&
      typeof hiveKeychain.requestHandshake === "function",

    hiveKeychainCustomJson:
      !!hiveKeychain &&
      typeof hiveKeychain.requestCustomJson === "function",

    hiveHandshake:
      !!hive &&
      typeof hive.requestHandshake === "function",

    hiveCustomJson:
      !!hive &&
      typeof hive.requestCustomJson === "function"
  };
}


function getKeychainProvider() {
  if (
    window.hive_keychain &&
    (
      typeof window.hive_keychain === "object" ||
      typeof window.hive_keychain === "function"
    ) &&
    (
      typeof window.hive_keychain.requestHandshake === "function" ||
      typeof window.hive_keychain.requestCustomJson === "function"
    )
  ) {
    return {
      provider: window.hive_keychain,
      name: "window.hive_keychain"
    };
  }

  if (
    window.hive &&
    (
      typeof window.hive === "object" ||
      typeof window.hive === "function"
    ) &&
    (
      typeof window.hive.requestHandshake === "function" ||
      typeof window.hive.requestCustomJson === "function"
    )
  ) {
    return {
      provider: window.hive,
      name: "window.hive"
    };
  }

  return null;
}


function keychain() {
  const detected = getKeychainProvider();

  return detected
    ? detected.provider
    : null;
}


/*
 * KEYCHAIN BUTTON UI
 */

function setKeychainButton(text, state = "normal") {
  const button = $("handshakeBtn");

  if (!button) return;

  button.textContent = text;

  if (state === "checking") {
    button.disabled = true;
    button.style.opacity = "0.75";
  } else {
    button.disabled = false;
    button.style.opacity = "1";
  }
}


/*
 * KEYCHAIN DIAGNOSTIC
 */

function checkKeychain(event) {
  if (event) {
    event.preventDefault();
  }

  setKeychainButton(
    "Checking…",
    "checking"
  );

  setStatus(
    "Checking Hive Keychain…"
  );

  console.log(
    "Hive Census: Check Keychain clicked."
  );

  setTimeout(() => {
    const diagnostic =
      inspectKeychain();

    console.log(
      "Hive Census Keychain diagnostic:",
      diagnostic
    );

    const detected =
      getKeychainProvider();

    if (!detected) {
      setKeychainButton(
        "Keychain not detected ✕"
      );

      setStatus(
        "Keychain diagnostic: " +
        `window.hive_keychain=${diagnostic.hiveKeychainExists ? "YES" : "NO"} · ` +
        `window.hive=${diagnostic.hiveExists ? "YES" : "NO"} · ` +
        "No compatible Keychain API detected.",
        true
      );

      return;
    }

    const kc =
      detected.provider;

    const hasHandshake =
      typeof kc.requestHandshake === "function";

    const hasCustomJson =
      typeof kc.requestCustomJson === "function";

    if (!hasHandshake) {
      if (hasCustomJson) {
        setKeychainButton(
          "Keychain API detected ✓"
        );

        setStatus(
          "Keychain API detected: " +
          `${detected.name} · ` +
          "Handshake=NO · Custom JSON=YES."
        );
      } else {
        setKeychainButton(
          "Keychain incomplete ✕"
        );

        setStatus(
          "A possible Keychain object was detected, " +
          "but neither requestHandshake nor requestCustomJson is available.",
          true
        );
      }

      return;
    }

    let finished = false;

    const finishSuccess = () => {
      if (finished) return;

      finished = true;

      setKeychainButton(
        "Keychain detected ✓"
      );

      setStatus(
        "Hive Keychain handshake successful. " +
        `${detected.name} · ` +
        `Custom JSON=${hasCustomJson ? "YES" : "NO"}`
      );
    };

    try {
      const result =
        kc.requestHandshake(
          response => {
            console.log(
              "Hive Census handshake callback:",
              response
            );

            finishSuccess();
          }
        );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result
          .then(response => {
            console.log(
              "Hive Census handshake promise:",
              response
            );

            finishSuccess();
          })
          .catch(error => {
            if (finished) return;

            finished = true;

            console.error(
              "Hive Census handshake promise error:",
              error
            );

            if (hasCustomJson) {
              setKeychainButton(
                "Keychain API detected ✓"
              );

              setStatus(
                "Keychain API detected. " +
                "Handshake returned an error, but Custom JSON=YES."
              );
            } else {
              setKeychainButton(
                "Handshake failed ✕"
              );

              setStatus(
                "Keychain API was detected, but handshake failed.",
                true
              );
            }
          });
      }

      setTimeout(() => {
        if (finished) return;

        finished = true;

        if (hasCustomJson) {
          setKeychainButton(
            "Keychain API detected ✓"
          );

          setStatus(
            "Keychain API detected, but the handshake did not return. " +
            `${detected.name} · Custom JSON=YES.`
          );
        } else {
          setKeychainButton(
            "Handshake no response"
          );

          setStatus(
            "Keychain API detected, but the handshake did not return " +
            "and requestCustomJson is unavailable.",
            true
          );
        }
      }, 3000);

    } catch (error) {
      finished = true;

      console.error(
        "Hive Census Keychain handshake error:",
        error
      );

      if (hasCustomJson) {
        setKeychainButton(
          "Keychain API detected ✓"
        );

        setStatus(
          "Keychain API detected. " +
          "Handshake produced an error, but Custom JSON=YES."
        );
      } else {
        setKeychainButton(
          "Keychain error ✕"
        );

        setStatus(
          "Keychain handshake error: " +
          (
            error && error.message
              ? error.message
              : String(error)
          ),
          true
        );
      }
    }

  }, 500);
}


/*
 * KEYCHAIN BUTTONS
 */

const handshakeButton =
  $("handshakeBtn");

if (handshakeButton) {
  handshakeButton.type = "button";
  handshakeButton.onclick =
    checkKeychain;
}


const connectButton =
  $("connectBtn");

if (connectButton) {
  connectButton.type = "button";

  connectButton.onclick = () => {
    location.hash = "join";

    setTimeout(
      () => checkKeychain(),
      300
    );
  };
}


/*
 * ACCOUNT
 */

function getAccount() {
  return $("account")
    .value
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}


function validHiveAccountName(account) {
  return /^[a-z][a-z0-9.-]{2,15}$/.test(
    account
  );
}


$("account").addEventListener(
  "input",
  updatePublishButton
);


/*
 * PERMANENCE ACKNOWLEDGEMENT
 */

$("permanentAck").addEventListener(
  "change",
  updatePublishButton
);


/*
 * PUBLISH BUTTON
 */

function updatePublishButton() {
  const account =
    getAccount();

  const acknowledged =
    $("permanentAck").checked;

  const ready =
    !publishing &&
    selected !== null &&
    validHiveAccountName(account) &&
    acknowledged;

  $("publishBtn").disabled =
    !ready;

  if (publishing) {
    $("publishBtn").textContent =
      "Waiting for Keychain…";
  } else if (ready) {
    $("publishBtn").textContent =
      "Publish to Hive";
  } else {
    $("publishBtn").textContent =
      "Complete the steps above to publish";
  }
}


/*
 * LIVE SEARCH
 */

$("placeQuery").addEventListener(
  "input",
  () => {
    const q =
      $("placeQuery").value.trim();

    clearTimeout(
      searchTimer
    );

    clearSelection();

    if (q.length < 3) {
      $("results").innerHTML = "";
      return;
    }

    $("results").innerHTML =
      '<div class="muted">Searching…</div>';

    searchTimer =
      setTimeout(
        () => searchPlaces(q),
        500
      );
  }
);


$("placeQuery").addEventListener(
  "keydown",
  e => {
    if (e.key !== "Enter") {
      return;
    }

    e.preventDefault();

    clearTimeout(
      searchTimer
    );

    const q =
      $("placeQuery").value.trim();

    if (q.length >= 3) {
      searchPlaces(q);
    }
  }
);


/*
 * SEARCH
 */

async function searchPlaces(query) {
  const q =
    query.trim();

  if (q.length < 3) {
    return;
  }

  lastSearch = q;

  if (searchController) {
    searchController.abort();
  }

  searchController =
    new AbortController();

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

    const res =
      await fetch(
        url,
        {
          headers: {
            "Accept-Language": "en"
          },
          signal:
            searchController.signal
        }
      );

    if (!res.ok) {
      throw new Error(
        "Geocoding request failed"
      );
    }

    const data =
      await res.json();

    if (lastSearch !== q) {
      return;
    }

    let places =
      data
        .map(
          p =>
            normalizePlace(
              p,
              q
            )
        )
        .filter(
          place =>
            place !== null
        );

    places =
      deduplicatePlaces(
        places
      );

    places.sort(
      (a, b) => {
        if (
          b.score !== a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        return a.displayLabel.localeCompare(
          b.displayLabel,
          undefined,
          {
            sensitivity:
              "base"
          }
        );
      }
    );

    renderResults(
      places
    );

  } catch (e) {
    if (
      e.name ===
      "AbortError"
    ) {
      return;
    }

    console.error(e);

    $("results").innerHTML =
      '<div class="muted">Search failed. Try again.</div>';
  }
}


/*
 * NORMALIZE PLACE
 */

function normalizePlace(
  p,
  query
) {
  const a =
    p.address || {};

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

  if (
    !city ||
    !countryName ||
    !countryCode
  ) {
    return null;
  }

  const regionName =
    a.state ||
    a.province ||
    a.region ||
    null;

  const regionCode =
    findSubdivisionCode(
      a,
      countryCode
    );

  const lat =
    Number(p.lat);

  const lon =
    Number(p.lon);

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

  const searchNames =
    collectSearchNames(
      p,
      city
    );

  const match =
    findBestMatch(
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

    country:
      countryCode,

    countryName,

    region:
      regionCode,

    regionName,

    lat,
    lon,

    displayLabel:
      displayParts.join(", "),

    matchedName:
      match.name,

    matchType:
      match.type,

    score:
      match.score,

    osmType:
      p.type || null,

    osmClass:
      p.class ||
      p.category ||
      null
  };
}


/*
 * SEARCH NAMES
 */

function collectSearchNames(
  p,
  city
) {
  const names =
    new Set();

  names.add(city);

  if (p.name) {
    names.add(
      p.name
    );
  }

  const namedetails =
    p.namedetails || {};

  for (
    const [key, value]
    of Object.entries(
      namedetails
    )
  ) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      if (
        key === "name" ||
        key.startsWith("name:") ||
        key.includes("official_name") ||
        key.includes("old_name") ||
        key.includes("alt_name") ||
        key.includes("short_name") ||
        key.includes("loc_name")
      ) {
        names.add(
          value.trim()
        );
      }
    }
  }

  const extras =
    p.extratags || {};

  [
    "official_name",
    "old_name",
    "alt_name",
    "short_name",
    "loc_name"
  ].forEach(
    key => {
      const value =
        extras[key];

      if (
        typeof value === "string" &&
        value.trim()
      ) {
        value
          .split(";")
          .map(
            v =>
              v.trim()
          )
          .filter(Boolean)
          .forEach(
            v =>
              names.add(v)
          );
      }
    }
  );

  return [...names];
}


/*
 * SEARCH RANKING
 */

function findBestMatch(
  query,
  city,
  names
) {
  const q =
    normalizeText(
      query
    );

  const normalizedCity =
    normalizeText(
      city
    );

  let best = {
    name:
      city,

    type:
      "locality",

    score:
      similarityScore(
        q,
        normalizedCity
      )
  };

  if (
    normalizedCity === q
  ) {
    best.score = 1000;
    best.type =
      "exact locality";
  } else if (
    normalizedCity.startsWith(q)
  ) {
    best.score = 900;
    best.type =
      "locality";
  }

  for (
    const name of names
  ) {
    const n =
      normalizeText(
        name
      );

    let score =
      similarityScore(
        q,
        n
      );

    let type =
      "related name";

    if (n === q) {
      score = 850;
      type =
        "matching name";
    } else if (
      n.startsWith(q)
    ) {
      score = 750;
    } else if (
      n.includes(q)
    ) {
      score = 650;
    }

    if (
      score >
      best.score
    ) {
      best = {
        name,
        type,
        score
      };
    }
  }

  return best;
}


function similarityScore(
  a,
  b
) {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 100;
  }

  if (
    b.startsWith(a)
  ) {
    return 90;
  }

  if (
    b.includes(a)
  ) {
    return 75;
  }

  const distance =
    levenshtein(
      a,
      b
    );

  const maxLength =
    Math.max(
      a.length,
      b.length
    );

  if (!maxLength) {
    return 0;
  }

  return Math.round(
    60 *
    (
      1 -
      distance /
      maxLength
    )
  );
}


function levenshtein(
  a,
  b
) {
  const matrix = [];

  for (
    let i = 0;
    i <= b.length;
    i++
  ) {
    matrix[i] = [i];
  }

  for (
    let j = 0;
    j <= a.length;
    j++
  ) {
    matrix[0][j] = j;
  }

  for (
    let i = 1;
    i <= b.length;
    i++
  ) {
    for (
      let j = 1;
      j <= a.length;
      j++
    ) {
      if (
        b.charAt(i - 1) ===
        a.charAt(j - 1)
      ) {
        matrix[i][j] =
          matrix[i - 1][j - 1];
      } else {
        matrix[i][j] =
          Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
      }
    }
  }

  return matrix[
    b.length
  ][
    a.length
  ];
}


function normalizeText(
  value
) {
  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLocaleLowerCase()
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}


/*
 * DEDUPLICATION
 */

function deduplicatePlaces(
  places
) {
  const unique =
    new Map();

  for (
    const place
    of places
  ) {
    const key = [
      normalizeText(
        place.city
      ),

      place.region ||
        normalizeText(
          place.regionName
        ),

      place.country
    ].join("|");

    const existing =
      unique.get(key);

    if (
      !existing ||
      place.score >
        existing.score
    ) {
      unique.set(
        key,
        place
      );
    }
  }

  return [
    ...unique.values()
  ];
}


/*
 * RESULTS
 */

function renderResults(
  places
) {
  $("results").innerHTML =
    "";

  if (!places.length) {
    $("results").innerHTML =
      '<div class="muted">No localities found.</div>';

    return;
  }

  places.forEach(
    place => {
      const div =
        document.createElement(
          "div"
        );

      div.className =
        "result";

      const main =
        document.createElement(
          "div"
        );

      main.textContent =
        place.displayLabel;

      div.appendChild(
        main
      );

      if (
        place.matchedName &&
        normalizeText(
          place.matchedName
        ) !==
          normalizeText(
            place.city
          )
      ) {
        const reason =
          document.createElement(
            "div"
          );

        reason.className =
          "muted";

        reason.style.fontSize =
          "0.82em";

        reason.style.marginTop =
          "6px";

        reason.textContent =
          `Found via: ${place.matchedName}`;

        div.appendChild(
          reason
        );
      }

      div.onclick =
        () =>
          choosePlace(
            place
          );

      $("results")
        .appendChild(
          div
        );
    }
  );
}


/*
 * ISO 3166-2
 */

function findSubdivisionCode(
  address,
  countryCode
) {
  const candidates = [];

  for (
    const [key, value]
    of Object.entries(
      address
    )
  ) {
    if (
      key
        .toUpperCase()
        .startsWith(
          "ISO3166-2-"
        ) &&
      typeof value ===
        "string"
    ) {
      candidates.push({
        key,
        value:
          value.toUpperCase()
      });
    }
  }

  const valid =
    candidates.filter(
      candidate =>
        candidate.value.startsWith(
          countryCode + "-"
        )
    );

  if (!valid.length) {
    return null;
  }

  valid.sort(
    (a, b) =>
      extractAdminLevel(
        a.key
      ) -
      extractAdminLevel(
        b.key
      )
  );

  return valid[0].value;
}


function extractAdminLevel(
  key
) {
  const match =
    key.match(
      /lvl(\d+)/i
    );

  return match
    ? Number(
        match[1]
      )
    : 999;
}


/*
 * SELECT LOCALITY
 */

function choosePlace(
  place
) {
  selected = place;

  $("selection")
    .classList
    .remove(
      "hidden"
    );

  const locationParts = [
    place.city,
    place.regionName,
    place.countryName
  ].filter(Boolean);

  $("selection").innerHTML =
    `<strong>${escapeHtml(
      locationParts.join(", ")
    )}</strong>` +
    `<br>` +
    `<span class="muted">` +
    `${place.lat.toFixed(4)}, ` +
    `${place.lon.toFixed(4)}` +
    `</span>`;

  $("jsonPreview").textContent =
    JSON.stringify(
      censusPayload(),
      null,
      2
    );

  map.setView(
    [
      place.lat,
      place.lon
    ],
    9
  );

  if (
    selectedMarker
  ) {
    map.removeLayer(
      selectedMarker
    );
  }

  selectedMarker =
    L.marker([
      place.lat,
      place.lon
    ])
      .addTo(map)
      .bindPopup(
        escapeHtml(
          place.displayLabel
        )
      )
      .openPopup();

  updatePublishButton();
}


/*
 * CLEAR SELECTION
 */

function clearSelection() {
  selected = null;

  if ($("selection")) {
    $("selection")
      .classList
      .add(
        "hidden"
      );

    $("selection").innerHTML =
      "";
  }

  if ($("jsonPreview")) {
    $("jsonPreview").textContent =
      "Choose a location to preview the exact data that will be signed.";
  }

  if (
    selectedMarker
  ) {
    map.removeLayer(
      selectedMarker
    );

    selectedMarker =
      null;
  }

  updatePublishButton();
}


/*
 * PROTOCOL v1.0 PAYLOAD
 */

function censusPayload() {
  if (!selected) {
    return null;
  }

  return {
    v:
      PROTOCOL_VERSION,

    action:
      "set",

    country:
      selected.country,

    country_name:
      selected.countryName,

    region:
      selected.region,

    region_name:
      selected.regionName,

    city:
      selected.city,

    lat:
      Number(
        selected.lat.toFixed(4)
      ),

    lon:
      Number(
        selected.lon.toFixed(4)
      )
  };
}


/*
 * BROADCAST
 */

$("publishBtn").onclick =
  () => {
    if (publishing) {
      return;
    }

    const account =
      getAccount();

    const payload =
      censusPayload();

    const acknowledged =
      $("permanentAck").checked;

    if (
      !validHiveAccountName(
        account
      )
    ) {
      setStatus(
        "Enter a valid Hive account.",
        true
      );

      return;
    }

    if (!payload) {
      setStatus(
        "Choose a locality first.",
        true
      );

      return;
    }

    if (!acknowledged) {
      setStatus(
        "Confirm that you understand the declaration is permanently recorded in blockchain history.",
        true
      );

      return;
    }

    const detected =
      getKeychainProvider();

    if (!detected) {
      setStatus(
        "No compatible Hive Keychain API detected.",
        true
      );

      return;
    }

    const kc =
      detected.provider;

    if (
      typeof kc.requestCustomJson !==
      "function"
    ) {
      setStatus(
        "Keychain was detected, but requestCustomJson is unavailable.",
        true
      );

      return;
    }

    const json =
      JSON.stringify(
        payload
      );

    publishing = true;

    updatePublishButton();

    setStatus(
      "Waiting for approval in Hive Keychain…"
    );

    try {
      kc.requestCustomJson(
        account,
        CUSTOM_JSON_ID,
        "Posting",
        json,
        "Publish Hive Census location",
        response => {
          publishing = false;

          updatePublishButton();

          console.log(
            "Hive Census Keychain response:",
            response
          );

          if (
            response &&
            response.success
          ) {
            setStatus(
              "Census declaration published successfully. " +
              "It will appear on the map after the Census indexer processes the new Hive block."
            );

            /*
             * The global map is derived from the D1 index.
             * The scheduled indexer may need a few minutes
             * to process the new irreversible Hive block.
             *
             * This refresh is opportunistic only.
             */
            setTimeout(
              loadCensusMap,
              10000
            );

            return;
          }

          let error =
            "The operation was cancelled or rejected.";

          if (response) {
            if (
              typeof response.message ===
              "string"
            ) {
              error =
                response.message;
            } else if (
              typeof response.error ===
              "string"
            ) {
              error =
                response.error;
            } else if (
              response.error
            ) {
              try {
                error =
                  JSON.stringify(
                    response.error
                  );
              } catch (_) {
                error =
                  String(
                    response.error
                  );
              }
            }
          }

          setStatus(
            `Publishing failed: ${error}`,
            true
          );
        }
      );

    } catch (error) {
      publishing = false;

      updatePublishButton();

      console.error(
        error
      );

      setStatus(
        "Publishing failed: " +
        (
          error &&
          error.message
            ? error.message
            : String(error)
        ),
        true
      );
    }
  };


/*
 * ============================================================
 * GLOBAL HIVE CENSUS READER
 * ============================================================
 *
 * v0.6.0
 *
 * The frontend no longer knows which Hive accounts
 * participate in Census.
 *
 * It reads the current active Census state from:
 *
 *     GET /api/census
 *
 * The API is backed by the derived D1 index.
 *
 * Hive remains the source of truth.
 */


/*
 * REMOVE EXISTING CENSUS MARKERS
 */

function clearCensusMarkers() {
  for (
    const marker
    of censusMarkers
  ) {
    map.removeLayer(
      marker
    );
  }

  censusMarkers = [];
}


/*
 * VALIDATE API RECORD
 *
 * This is defensive frontend validation.
 * Protocol validation is performed by the indexer
 * before records enter census_current.
 */

function validCensusApiRecord(
  record
) {
  if (
    !record ||
    typeof record !== "object"
  ) {
    return false;
  }

  if (
    typeof record.account !== "string" ||
    !record.account.trim()
  ) {
    return false;
  }

  if (
    typeof record.country !== "string" ||
    !/^[A-Z]{2}$/.test(
      record.country
    )
  ) {
    return false;
  }

  if (
    typeof record.country_name !== "string" ||
    !record.country_name.trim()
  ) {
    return false;
  }

  if (
    typeof record.city !== "string" ||
    !record.city.trim()
  ) {
    return false;
  }

  if (
    typeof record.lat !== "number" ||
    !Number.isFinite(
      record.lat
    ) ||
    record.lat < -90 ||
    record.lat > 90
  ) {
    return false;
  }

  if (
    typeof record.lon !== "number" ||
    !Number.isFinite(
      record.lon
    ) ||
    record.lon < -180 ||
    record.lon > 180
  ) {
    return false;
  }

  return true;
}


/*
 * CREATE CENSUS MARKER
 */

function addCensusMarker(
  record
) {
  if (
    !validCensusApiRecord(
      record
    )
  ) {
    return null;
  }

  const locationParts = [
    record.city,
    record.region_name,
    record.country_name
  ].filter(Boolean);

  const popup =
    `<strong>@${escapeHtml(
      record.account
    )}</strong>` +
    `<br>` +
    `${escapeHtml(
      locationParts.join(", ")
    )}` +
    `<br>` +
    `<span style="opacity:.7;font-size:.85em">` +
    `Hive Census · protocol v${PROTOCOL_VERSION}` +
    `</span>`;

  const marker =
    L.marker([
      record.lat,
      record.lon
    ])
      .addTo(map)
      .bindPopup(
        popup
      );

  censusMarkers.push(
    marker
  );

  return marker;
}


/*
 * LOAD GLOBAL CENSUS MAP
 */

async function loadCensusMap() {
  console.log(
    `Hive Census v${CENSUS_VERSION}: loading global Census index…`
  );

  try {
    const response =
      await fetch(
        CENSUS_API,
        {
          method:
            "GET",

          headers: {
            "Accept":
              "application/json"
          },

          cache:
            "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `Census API HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    if (
      !data ||
      data.ok !== true ||
      !Array.isArray(
        data.census
      )
    ) {
      throw new Error(
        "Census API returned an invalid response."
      );
    }

    /*
     * Only replace existing markers after
     * a valid API response has been received.
     *
     * This prevents a temporary API failure
     * from unnecessarily clearing the map.
     */
    clearCensusMarkers();

    const activeRecords = [];

    for (
      const record
      of data.census
    ) {
      if (
        !validCensusApiRecord(
          record
        )
      ) {
        console.warn(
          "Hive Census: invalid API record ignored:",
          record
        );

        continue;
      }

      activeRecords.push(
        record
      );

      addCensusMarker(
        record
      );
    }

    /*
     * One declaration:
     * show its region.
     *
     * Multiple declarations:
     * fit all markers.
     *
     * Zero declarations:
     * retain the default world view.
     */

    if (
      activeRecords.length === 1
    ) {
      const record =
        activeRecords[0];

      map.setView(
        [
          record.lat,
          record.lon
        ],
        7
      );
    }

    else if (
      activeRecords.length > 1
    ) {
      const bounds =
        L.latLngBounds(
          activeRecords.map(
            record => [
              record.lat,
              record.lon
            ]
          )
        );

      map.fitBounds(
        bounds,
        {
          padding:
            [40, 40],

          maxZoom:
            8
        }
      );
    }

    console.log(
      `Hive Census: ${activeRecords.length} active Census declaration(s) loaded from global index.`
    );

    return activeRecords;

  } catch (error) {
    console.error(
      "Hive Census: failed to load global Census index:",
      error
    );

    return [];
  }
}


/*
 * HTML SAFETY
 */

function escapeHtml(
  s = ""
) {
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

const map =
  L.map(
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
    maxZoom:
      19,

    attribution:
      '&copy; OpenStreetMap contributors'
  }
).addTo(map);


/*
 * INITIAL STATE
 */

if (handshakeButton) {
  handshakeButton.textContent =
    "Check Keychain";
}

updatePublishButton();

console.log(
  `Hive Census app.js v${CENSUS_VERSION} loaded`
);


/*
 * LOAD GLOBAL CENSUS DATA
 */

loadCensusMap();
