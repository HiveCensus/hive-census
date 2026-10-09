
const $ = id => document.getElementById(id);

let selected = null;
let selectedMarker = null;
let censusMarkers = [];
let searchTimer = null;
let searchController = null;
let lastSearch = "";
let publishing = false;
let unsetting = false;
let currentCensusRecords = [];

const CENSUS_VERSION = "0.6.7";
const PROTOCOL_VERSION = 1;
const CUSTOM_JSON_ID = "hive_census";
const CENSUS_API = "/api/census";
const INDEXER_STATUS_API = "/api/indexer/status";
const INDEXER_STATUS_REFRESH_MS = 60000;


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

  setTimeout(() => {
    const diagnostic =
      inspectKeychain();

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
          `${detected.name} · Custom JSON=YES.`
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
        "Hive Keychain handshake successful."
      );
    };

    try {
      const result =
        kc.requestHandshake(
          () => {
            finishSuccess();
          }
        );

      if (
        result &&
        typeof result.then === "function"
      ) {
        result
          .then(() => {
            finishSuccess();
          })
          .catch(() => {
            if (finished) return;

            finished = true;

            if (hasCustomJson) {
              setKeychainButton(
                "Keychain API detected ✓"
              );

              setStatus(
                "Keychain API detected. Custom JSON=YES."
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
            "Keychain API detected. Custom JSON=YES."
          );
        }
      }, 3000);

    } catch (error) {
      finished = true;

      if (hasCustomJson) {
        setKeychainButton(
          "Keychain API detected ✓"
        );

        setStatus(
          "Keychain API detected. Custom JSON=YES."
        );
      } else {
        setKeychainButton(
          "Keychain error ✕"
        );

        setStatus(
          "Keychain error.",
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
  () => {
    updatePublishButton();
    updateCurrentDeclaration();
  }
);


/*
 * CURRENT DECLARATION
 */

function findCurrentDeclaration(
  account
) {
  if (
    !account ||
    !Array.isArray(
      currentCensusRecords
    )
  ) {
    return null;
  }

  return (
    currentCensusRecords.find(
      record =>
        String(
          record.account || ""
        ).toLowerCase() ===
        account.toLowerCase()
    ) || null
  );
}


function updateCurrentDeclaration() {
  const panel =
    $("currentDeclaration");

  const location =
    $("currentDeclarationLocation");

  const confirmation =
    $("leaveCensusConfirm");

  if (
    !panel ||
    !location
  ) {
    return;
  }

  const account =
    getAccount();

  if (
    !validHiveAccountName(
      account
    )
  ) {
    panel.classList.add(
      "hidden"
    );

    if (confirmation) {
      confirmation.classList.add(
        "hidden"
      );
    }

    return;
  }

  const record =
    findCurrentDeclaration(
      account
    );

  if (!record) {
    panel.classList.add(
      "hidden"
    );

    if (confirmation) {
      confirmation.classList.add(
        "hidden"
      );
    }

    return;
  }

  const parts = [
    record.city,
    record.region_name,
    record.country_name
  ].filter(Boolean);

  location.innerHTML =
    `<strong>${escapeHtml(
      parts.join(", ")
    )}</strong>` +
    `<br>` +
    `<span class="muted">` +
    `@${escapeHtml(
      record.account
    )} is currently included in the Census.` +
    `</span>`;

  panel.classList.remove(
    "hidden"
  );

  if (
    confirmation &&
    !unsetting
  ) {
    confirmation.classList.add(
      "hidden"
    );
  }
}


/*
 * LEAVE CENSUS UI
 */

const leaveCensusButton =
  $("leaveCensusBtn");

if (leaveCensusButton) {
  leaveCensusButton.onclick =
    () => {
      const confirmation =
        $("leaveCensusConfirm");

      if (confirmation) {
        confirmation.classList.remove(
          "hidden"
        );
      }
    };
}


const cancelUnsetButton =
  $("cancelUnsetBtn");

if (cancelUnsetButton) {
  cancelUnsetButton.onclick =
    () => {
      const confirmation =
        $("leaveCensusConfirm");

      if (confirmation) {
        confirmation.classList.add(
          "hidden"
        );
      }
    };
}


/*
 * UNSET PAYLOAD
 */

function censusUnsetPayload() {
  return {
    v:
      PROTOCOL_VERSION,

    action:
      "unset"
  };
}


/*
 * PUBLISH UNSET
 */

const publishUnsetButton =
  $("publishUnsetBtn");

if (publishUnsetButton) {
  publishUnsetButton.onclick =
    () => {
      if (unsetting) {
        return;
      }

      const account =
        getAccount();

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

      const current =
        findCurrentDeclaration(
          account
        );

      if (!current) {
        setStatus(
          "This account has no active Census declaration.",
          true
        );

        updateCurrentDeclaration();

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
          censusUnsetPayload()
        );

      unsetting = true;

      publishUnsetButton.disabled =
        true;

      publishUnsetButton.textContent =
        "Waiting for Keychain…";

      setStatus(
        "Waiting for approval in Hive Keychain…"
      );

      try {
        kc.requestCustomJson(
          account,
          CUSTOM_JSON_ID,
          "Posting",
          json,
          "Leave Hive Census",
          response => {
            unsetting = false;

            publishUnsetButton.disabled =
              false;

            publishUnsetButton.textContent =
              "Publish unset";

            console.log(
              "Hive Census unset response:",
              response
            );

            if (
              response &&
              response.success
            ) {
              setStatus(
                "Unset published successfully. " +
                "Your account will disappear from the current Census after the indexer processes the new Hive block."
              );

              const confirmation =
                $("leaveCensusConfirm");

              if (confirmation) {
                confirmation.classList.add(
                  "hidden"
                );
              }

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
              `Publishing unset failed: ${error}`,
              true
            );
          }
        );

      } catch (error) {
        unsetting = false;

        publishUnsetButton.disabled =
          false;

        publishUnsetButton.textContent =
          "Publish unset";

        console.error(
          error
        );

        setStatus(
          "Publishing unset failed: " +
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
}


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
 * LOCALITY HELPERS
 */

function getAddressLocality(
  address
) {
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    null
  );
}


function isLocalityResult(
  place
) {
  const category =
    String(
      place.category ||
      place.class ||
      ""
    ).toLowerCase();

  const type =
    String(
      place.type ||
      ""
    ).toLowerCase();

  if (
    category !== "place"
  ) {
    return false;
  }

  return [
    "city",
    "town",
    "village",
    "hamlet"
  ].includes(type);
}


function getCanonicalLocalityName(
  place,
  addressLocality,
  countryCode
) {
  if (
    !isLocalityResult(
      place
    )
  ) {
    return addressLocality;
  }

  const namedetails =
    place.namedetails || {};

  const localLanguageKey =
    countryCode
      ? `name:${countryCode.toLowerCase()}`
      : null;

  if (
    localLanguageKey &&
    typeof namedetails[localLanguageKey] === "string" &&
    namedetails[localLanguageKey].trim()
  ) {
    return namedetails[
      localLanguageKey
    ].trim();
  }

  if (
    typeof namedetails.name === "string" &&
    namedetails.name.trim()
  ) {
    return namedetails.name.trim();
  }

  if (
    typeof place.name === "string" &&
    place.name.trim()
  ) {
    return place.name.trim();
  }

  return addressLocality;
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

  const addressLocality =
    getAddressLocality(
      a
    );

  const countryName =
    a.country ||
    null;

  const countryCode =
    a.country_code
      ? a.country_code.toUpperCase()
      : null;

  if (
    !addressLocality ||
    !countryName ||
    !countryCode
  ) {
    return null;
  }

  const localityResult =
    isLocalityResult(
      p
    );

  const city =
    getCanonicalLocalityName(
      p,
      addressLocality,
      countryCode
    );

  if (!city) {
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

  if (
    normalizeText(
      addressLocality
    ) !==
    normalizeText(
      city
    )
  ) {
    searchNames.push(
      addressLocality
    );
  }

  const match =
    findBestMatch(
      query,
      city,
      searchNames
    );

  const localityBonus =
    localityResult
      ? 200
      : 0;

  const displayParts = [
    city,
    regionName,
    countryName
  ].filter(Boolean);

  let foundVia =
    match.name;

  if (
    !localityResult &&
    typeof p.name === "string" &&
    p.name.trim()
  ) {
    foundVia =
      p.name.trim();
  }

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
      foundVia,

    matchType:
      localityResult
        ? match.type
        : "point of interest",

    score:
      match.score +
      localityBonus,

    localityResult,

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
 * SET PAYLOAD
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
 * PUBLISH SET
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
        JSON.stringify(
          payload
        ),
        "Publish Hive Census location",
        response => {
          publishing = false;

          updatePublishButton();

          if (
            response &&
            response.success
          ) {
            setStatus(
              "Census declaration published successfully. " +
              "It will appear on the map after the Census indexer processes the new Hive block."
            );

            setTimeout(
              loadCensusMap,
              10000
            );

            return;
          }

          let error =
            "The operation was cancelled or rejected.";

          if (
            response &&
            typeof response.message ===
              "string"
          ) {
            error =
              response.message;
          } else if (
            response &&
            typeof response.error ===
              "string"
          ) {
            error =
              response.error;
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
 * CENSUS MAP
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
    )
  ) {
    return false;
  }

  if (
    typeof record.lon !== "number" ||
    !Number.isFinite(
      record.lon
    )
  ) {
    return false;
  }

  return true;
}


function censusLocalityKey(
  record
) {
  return [
    record.country,
    record.region || "",
    normalizeText(
      record.city
    ),
    Number(record.lat).toFixed(4),
    Number(record.lon).toFixed(4)
  ].join("|");
}


function groupCensusByLocality(
  records
) {
  const groups =
    new Map();

  for (
    const record
    of records
  ) {
    const key =
      censusLocalityKey(
        record
      );

    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        {
          city:
            record.city,

          region:
            record.region || null,

          region_name:
            record.region_name || null,

          country:
            record.country,

          country_name:
            record.country_name,

          lat:
            record.lat,

          lon:
            record.lon,

          accounts:
            []
        }
      );
    }

    groups
      .get(key)
      .accounts
      .push(
        record.account
      );
  }

  const result =
    [...groups.values()];

  for (
    const group
    of result
  ) {
    group.accounts.sort(
      (a, b) =>
        a.localeCompare(
          b,
          undefined,
          {
            sensitivity:
              "base"
          }
        )
    );
  }

  return result;
}


function addCensusLocalityMarker(
  locality
) {
  const locationParts = [
    locality.city,
    locality.region_name,
    locality.country_name
  ].filter(Boolean);

  const userCount =
    locality.accounts.length;

  const userLabel =
    userCount === 1
      ? "1 Hive user"
      : `${userCount} Hive users`;

  const accountsHtml =
    locality.accounts
      .map(
        account =>
          `@${escapeHtml(
            account
          )}`
      )
      .join("<br>");

  const popup =
    `<strong>${escapeHtml(
      locationParts.join(", ")
    )}</strong>` +
    `<br>` +
    `<span style="opacity:.75">` +
    `${userLabel}` +
    `</span>` +
    `<div style="margin-top:8px">` +
    `${accountsHtml}` +
    `</div>` +
    `<div style="margin-top:8px;opacity:.7;font-size:.85em">` +
    `Hive Census · protocol v${PROTOCOL_VERSION}` +
    `</div>`;

  const marker =
    L.marker([
      locality.lat,
      locality.lon
    ])
      .addTo(map)
      .bindPopup(
        popup
      );

  censusMarkers.push(
    marker
  );
}


function updateCensusStats(
  userCount,
  localityCount
) {
  const stats =
    $("censusStats");

  if (!stats) {
    return;
  }

  stats.textContent =
    `${userCount} ${userCount === 1 ? "user" : "users"} · ` +
    `${localityCount} ${localityCount === 1 ? "locality" : "localities"}`;
}


async function loadCensusMap() {
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
        data.accounts
      )
    ) {
      throw new Error(
        "Invalid Census API response."
      );
    }

    const activeRecords =
      data.accounts.filter(
        validCensusApiRecord
      );

    currentCensusRecords =
      activeRecords;

    const localities =
      groupCensusByLocality(
        activeRecords
      );

    updateCensusStats(
      activeRecords.length,
      localities.length
    );

    updateCurrentDeclaration();

    clearCensusMarkers();

    for (
      const locality
      of localities
    ) {
      addCensusLocalityMarker(
        locality
      );
    }

    if (
      localities.length === 1
    ) {
      map.setView(
        [
          localities[0].lat,
          localities[0].lon
        ],
        9
      );
    }

    else if (
      localities.length > 1
    ) {
      const bounds =
        L.latLngBounds(
          localities.map(
            locality => [
              locality.lat,
              locality.lon
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

    return {
      records:
        activeRecords,

      localities
    };

  } catch (error) {
    console.error(
      "Hive Census: failed to load Census:",
      error
    );

    const stats =
      $("censusStats");

    if (stats) {
      stats.textContent =
        "Census data temporarily unavailable";
    }

    return {
      records: [],
      localities: []
    };
  }
}


/*
 * BLOCKCHAIN / INDEXER STATUS
 */

function formatIndexerTime(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date.toLocaleString(
    undefined,
    {
      dateStyle: "short",
      timeStyle: "short"
    }
  );
}


function setIndexerStatus(
  state,
  data = null
) {
  const status =
    $("indexerStatus");

  const text =
    $("indexerStatusText");

  if (
    !status ||
    !text
  ) {
    return;
  }

  status.classList.remove(
    "indexer-status-loading",
    "indexer-status-synced",
    "indexer-status-syncing",
    "indexer-status-behind",
    "indexer-status-unavailable"
  );

  let label =
    "Census status unavailable";

  let cssClass =
    "indexer-status-unavailable";

  if (
    state === "synced"
  ) {
    label =
      "Census synced";

    cssClass =
      "indexer-status-synced";
  }

  else if (
    state === "catching_up"
  ) {
    label =
      "Census syncing";

    cssClass =
      "indexer-status-syncing";
  }

  else if (
    state === "stalled" ||
    state === "error"
  ) {
    label =
      "Census temporarily behind";

    cssClass =
      "indexer-status-behind";
  }

  status.classList.add(
    cssClass
  );

  text.textContent =
    label;

  if (!data) {
    status.title =
      "Hive Census synchronization status is currently unavailable.";

    return;
  }

  const details = [
    label
  ];

  const blocksBehind =
    Number(
      data.blocks_behind
    );

  if (
    Number.isFinite(
      blocksBehind
    )
  ) {
    details.push(
      `${blocksBehind.toLocaleString()} blocks behind Hive`
    );
  }

  const lastSuccessfulScan =
    formatIndexerTime(
      data.last_successful_scan
    );

  if (
    lastSuccessfulScan
  ) {
    details.push(
      `Last successful scan: ${lastSuccessfulScan}`
    );
  }

  if (
    data.last_error
  ) {
    details.push(
      `Indexer error: ${data.last_error}`
    );
  }

  status.title =
    details.join("\n");
}


async function loadIndexerStatus() {
  try {
    const response =
      await fetch(
        INDEXER_STATUS_API,
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
        `Indexer status HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    if (
      !data ||
      data.ok !== true ||
      typeof data.indexer_state !==
        "string"
    ) {
      throw new Error(
        "Invalid indexer status response."
      );
    }

    setIndexerStatus(
      data.indexer_state,
      data
    );

    return data;

  } catch (error) {
    console.error(
      "Hive Census: failed to load indexer status:",
      error
    );

    setIndexerStatus(
      "unavailable"
    );

    return null;
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

loadCensusMap();
loadIndexerStatus();

setInterval(
  loadIndexerStatus,
  INDEXER_STATUS_REFRESH_MS
);
