
/*
 * Hive Census — Administrator API
 * Version 0.2.4
 *
 * - Hive Keychain authentication and HttpOnly sessions
 * - Server-side search across ambiguous locations
 * - Manual match/reject with account-specific override protection
 * - NOT NULL-safe rejection and manual audit fields
 * - Authenticated profile rescan status and start endpoints
 * - Initial-import and duplicate-rescan protection
 */

import {
  ADMIN_ACCOUNT,
  createAdminChallenge,
  validateAdminChallenge,
  verifyAdminSignature,
  createAdminSessionToken,
  hashAdminSessionToken,
  createAdminSessionCookie,
  clearAdminSessionCookie,
  readAdminSessionCookie,
  adminSessionExpiresAt
} from "./admin-auth.js";

import {
  startProfileRescan,
  getProfileRescanStatus
} from "./worker-core.js";

const VERSION = "0.2.4";
const HIVE_RPC = "https://api.hive.blog";
const MAX_BODY_BYTES = 8192;
const MAX_SIGNATURE_LENGTH = 256;
const DEFAULT_REVIEW_LIMIT = 50;
const MAX_REVIEW_LIMIT = 100;
const MAX_SEARCH_LENGTH = 150;

const SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

function respond(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders }
  });
}

function failure(message, status = 400) {
  return respond({ ok: false, error: message }, status);
}

function requestIsSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);

    return (
      originUrl.origin === requestUrl.origin &&
      originUrl.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function validateMutationRequest(request) {
  if (!requestIsSameOrigin(request)) {
    return failure("Invalid request origin", 403);
  }

  const contentType = request.headers.get("Content-Type") || "";

  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return failure(
      "Content-Type must be application/json",
      415
    );
  }

  return null;
}

async function readJsonBody(request) {
  const contentLengthHeader =
    request.headers.get("Content-Length");

  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_BODY_BYTES
    ) {
      throw new Error("Request body too large");
    }
  }

  const text = await request.text();

  if (
    new TextEncoder().encode(text).length >
    MAX_BODY_BYTES
  ) {
    throw new Error("Request body too large");
  }

  const data = JSON.parse(text);

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new Error("Invalid JSON object");
  }

  return data;
}

async function hiveRpc(method, params) {
  const response = await fetch(HIVE_RPC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: 1
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(
      `Hive RPC unavailable: ${response.status}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error("Hive RPC returned an error");
  }

  return data.result;
}

async function fetchAdminAccount() {
  const accounts = await hiveRpc(
    "condenser_api.get_accounts",
    [[ADMIN_ACCOUNT]]
  );

  if (
    !Array.isArray(accounts) ||
    accounts.length !== 1 ||
    accounts[0]?.name !== ADMIN_ACCOUNT
  ) {
    throw new Error(
      "Administrator account unavailable"
    );
  }

  return accounts[0];
}

// ============================================================
// AUTHENTICATION
// ============================================================

async function createChallenge(env) {
  const challenge = createAdminChallenge();

  await env.DB.prepare(`
    INSERT INTO admin_auth_challenges (
      nonce, account, message, expires_at
    )
    VALUES (?, ?, ?, ?)
  `).bind(
    challenge.nonce,
    challenge.account,
    challenge.message,
    challenge.expires_at
  ).run();

  return respond({
    ok: true,
    account: challenge.account,
    nonce: challenge.nonce,
    message: challenge.message,
    expires_at: challenge.expires_at
  });
}

async function login(request, env) {
  let body;

  try {
    body = await readJsonBody(request);
  } catch {
    return failure("Invalid request body");
  }

  const nonce = body.nonce;
  const signature = body.signature;

  if (
    typeof nonce !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(nonce) ||
    typeof signature !== "string" ||
    signature.length > MAX_SIGNATURE_LENGTH ||
    !/^[0-9a-f]+$/i.test(signature)
  ) {
    return failure(
      "Invalid authentication data"
    );
  }

  const stored = await env.DB.prepare(`
    SELECT
      nonce,
      account,
      message,
      expires_at,
      consumed_at
    FROM admin_auth_challenges
    WHERE nonce = ?
  `).bind(nonce).first();

  if (
    !stored ||
    stored.consumed_at !== null
  ) {
    return failure(
      "Authentication challenge unavailable",
      401
    );
  }

  const challenge = {
    nonce: stored.nonce,
    account: stored.account,
    message: stored.message,
    expires_at: stored.expires_at
  };

  if (
    !validateAdminChallenge(challenge, nonce)
  ) {
    return failure(
      "Authentication challenge expired or invalid",
      401
    );
  }

  const accountData = await fetchAdminAccount();

  const valid = await verifyAdminSignature(
    challenge,
    signature,
    accountData
  );

  if (!valid) {
    return failure(
      "Invalid administrator signature",
      401
    );
  }

  const consumed = await env.DB.prepare(`
    UPDATE admin_auth_challenges
    SET consumed_at = CURRENT_TIMESTAMP
    WHERE nonce = ?
      AND account = ?
      AND consumed_at IS NULL
      AND julianday(expires_at) > julianday('now')
  `).bind(
    nonce,
    ADMIN_ACCOUNT
  ).run();

  if (
    Number(consumed.meta?.changes || 0) !== 1
  ) {
    return failure(
      "Authentication challenge already used",
      401
    );
  }

  const token = createAdminSessionToken();
  const tokenHash = await hashAdminSessionToken(token);
  const expiresAt = adminSessionExpiresAt();

  await env.DB.prepare(`
    INSERT INTO admin_sessions (
      token_hash,
      account,
      expires_at
    )
    VALUES (?, ?, ?)
  `).bind(
    tokenHash,
    ADMIN_ACCOUNT,
    expiresAt
  ).run();

  return respond({
    ok: true,
    authenticated: true,
    account: ADMIN_ACCOUNT,
    expires_at: expiresAt
  }, 200, {
    "Set-Cookie": createAdminSessionCookie(token)
  });
}

export async function getAdminSession(request, env) {
  const token = readAdminSessionCookie(request);

  if (!token) return null;

  const tokenHash = await hashAdminSessionToken(token);

  const session = await env.DB.prepare(`
    SELECT
      account,
      created_at,
      expires_at
    FROM admin_sessions
    WHERE token_hash = ?
      AND account = ?
      AND revoked_at IS NULL
      AND julianday(expires_at) > julianday('now')
  `).bind(
    tokenHash,
    ADMIN_ACCOUNT
  ).first();

  if (!session) return null;

  return {
    account: session.account,
    created_at: session.created_at,
    expires_at: session.expires_at
  };
}

async function sessionStatus(request, env) {
  const session = await getAdminSession(
    request, env
  );

  if (!session) {
    return respond({
      ok: true,
      authenticated: false
    });
  }

  return respond({
    ok: true,
    authenticated: true,
    account: session.account,
    created_at: session.created_at,
    expires_at: session.expires_at
  });
}

async function logout(request, env) {
  const token = readAdminSessionCookie(request);

  if (token) {
    const tokenHash =
      await hashAdminSessionToken(token);

    await env.DB.prepare(`
      UPDATE admin_sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = ?
        AND revoked_at IS NULL
    `).bind(tokenHash).run();
  }

  return respond({
    ok: true,
    authenticated: false
  }, 200, {
    "Set-Cookie": clearAdminSessionCookie()
  });
}

export async function requireAdminSession(
  request, env
) {
  const session = await getAdminSession(
    request, env
  );

  if (!session) {
    return {
      authorized: false,
      session: null,
      response: failure(
        "Administrator authentication required",
        401
      )
    };
  }

  return {
    authorized: true,
    session,
    response: null
  };
}

// ============================================================
// AMBIGUOUS LOCATION REVIEW
// ============================================================

function escapeLike(value) {
  return value.replace(
    /[\\%_]/g,
    char => "\\" + char
  );
}

async function listAmbiguousLocations(request, env) {
  const url = new URL(request.url);

  const requestedLimit = Number(
    url.searchParams.get("limit") ||
    DEFAULT_REVIEW_LIMIT
  );

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(
        MAX_REVIEW_LIMIT,
        Math.max(1, Math.floor(requestedLimit))
      )
    : DEFAULT_REVIEW_LIMIT;

  const requestedOffset = Number(
    url.searchParams.get("offset") || 0
  );

  const offset = (
    Number.isSafeInteger(requestedOffset) &&
    requestedOffset >= 0
  ) ? requestedOffset : 0;

  const search = (
    url.searchParams.get("search") || ""
  ).trim();

  if (search.length > MAX_SEARCH_LENGTH) {
    return failure(
      `Search term exceeds ${MAX_SEARCH_LENGTH} characters`,
      400
    );
  }

  const pattern = `%${escapeLike(search)}%`;

  const result = await env.DB.prepare(`
    SELECT
      m.id,
      m.location_key,
      m.original_example,
      m.status,
      m.location_type,
      m.country,
      m.country_name,
      m.region,
      m.region_name,
      m.city,
      m.lat,
      m.lon,
      m.confidence,
      m.source,
      m.updated_at,
      COUNT(p.account) AS affected_accounts
    FROM location_matches m
    LEFT JOIN profile_locations p
      ON p.match_id = m.id
      AND NOT EXISTS (
        SELECT 1
        FROM profile_location_overrides o
        WHERE o.account = p.account
          AND o.match_id = p.match_id
      )
    WHERE m.status = 'ambiguous'
      AND (
        m.original_example LIKE ? ESCAPE '\\'
        OR m.location_key LIKE ? ESCAPE '\\'
      )
    GROUP BY m.id
    ORDER BY
      affected_accounts DESC,
      m.id ASC
    LIMIT ? OFFSET ?
  `).bind(
    pattern,
    pattern,
    limit,
    offset
  ).all();

  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM location_matches m
    WHERE m.status = 'ambiguous'
      AND (
        m.original_example LIKE ? ESCAPE '\\'
        OR m.location_key LIKE ? ESCAPE '\\'
      )
  `).bind(
    pattern,
    pattern
  ).first();

  const total = Number(
    countRow?.total || 0
  );

  return respond({
    ok: true,
    version: VERSION,
    account: ADMIN_ACCOUNT,
    search,
    total,
    limit,
    offset,
    count: result.results.length,
    has_more:
      offset + result.results.length < total,
    locations: result.results
  });
}

function validOptionalString(value, maxLength) {
  return (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.length <= maxLength
    )
  );
}

function cleanOptionalString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function validateResolution(body) {
  if (
    !Number.isSafeInteger(body.id) ||
    body.id < 1
  ) {
    return "Invalid location ID";
  }

  if (
    body.action !== "match" &&
    body.action !== "reject"
  ) {
    return "Invalid review action";
  }

  if (body.action === "reject") {
    return null;
  }

  if (
    ![
      "locality",
      "region_proxy",
      "country_proxy"
    ].includes(body.location_type)
  ) {
    return "Invalid location type";
  }

  if (
    typeof body.country !== "string" ||
    !/^[A-Z]{2}$/.test(body.country)
  ) {
    return (
      "Country must be an ISO 3166-1 alpha-2 code"
    );
  }

  if (
    typeof body.country_name !== "string" ||
    !body.country_name.trim() ||
    body.country_name.length > 150
  ) {
    return "Invalid country name";
  }

  if (
    !validOptionalString(body.region, 50) ||
    !validOptionalString(body.region_name, 150) ||
    !validOptionalString(body.city, 150)
  ) {
    return "Invalid region or city";
  }

  if (
    typeof body.lat !== "number" ||
    typeof body.lon !== "number" ||
    !Number.isFinite(body.lat) ||
    !Number.isFinite(body.lon) ||
    body.lat < -90 ||
    body.lat > 90 ||
    body.lon < -180 ||
    body.lon > 180
  ) {
    return "Invalid geographical coordinates";
  }

  if (
    body.location_type === "locality" &&
    !cleanOptionalString(body.city)
  ) {
    return "City is required for a locality";
  }

  if (
    body.location_type === "region_proxy" &&
    (
      !cleanOptionalString(body.region_name) ||
      !cleanOptionalString(body.city)
    )
  ) {
    return (
      "Region and representative city are required"
    );
  }

  if (
    body.location_type === "country_proxy" &&
    !cleanOptionalString(body.city)
  ) {
    return "Representative city is required";
  }

  return null;
}

async function resolveAmbiguousLocation(
  request,
  env,
  administrator
) {
  let body;

  try {
    body = await readJsonBody(request);
  } catch {
    return failure("Invalid request body");
  }

  const validationError =
    validateResolution(body);

  if (validationError) {
    return failure(validationError, 400);
  }

  const existing = await env.DB.prepare(`
    SELECT
      id,
      original_example,
      status,
      location_type
    FROM location_matches
    WHERE id = ?
  `).bind(body.id).first();

  if (!existing) {
    return failure(
      "Location not found",
      404
    );
  }

  if (existing.status !== "ambiguous") {
    return failure(
      "Location has already been resolved",
      409
    );
  }

  const isMatch = body.action === "match";
  const status = isMatch
    ? "matched"
    : "rejected";

  const locationType = isMatch
    ? body.location_type
    : existing.location_type;

  const update = env.DB.prepare(`
    UPDATE location_matches
    SET
      status = ?,
      location_type = ?,
      country = ?,
      country_name = ?,
      region = ?,
      region_name = ?,
      city = ?,
      lat = ?,
      lon = ?,
      confidence = ?,
      source = 'admin_manual',
      reviewed_by = ?,
      reviewed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'ambiguous'
  `).bind(
    status,
    locationType,
    isMatch ? body.country : null,
    isMatch ? body.country_name.trim() : null,
    isMatch
      ? cleanOptionalString(body.region)
      : null,
    isMatch
      ? cleanOptionalString(body.region_name)
      : null,
    isMatch
      ? cleanOptionalString(body.city)
      : null,
    isMatch ? body.lat : null,
    isMatch ? body.lon : null,
    isMatch ? 1 : null,
    administrator,
    body.id
  );

  const sync = env.DB.prepare(`
    UPDATE profile_locations
    SET match_status = ?
    WHERE match_id = ?
      AND match_status IS NOT ?
      AND EXISTS (
        SELECT 1
        FROM location_matches
        WHERE id = ?
          AND status = ?
          AND source = 'admin_manual'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM profile_location_overrides o
        WHERE o.account =
          profile_locations.account
          AND o.match_id =
          profile_locations.match_id
      )
  `).bind(
    status,
    body.id,
    status,
    body.id,
    status
  );

  const results = await env.DB.batch([
    update,
    sync
  ]);

  const changes = Number(
    results[0]?.meta?.changes || 0
  );

  if (changes !== 1) {
    return failure(
      "Location was modified concurrently; refresh the queue",
      409
    );
  }

  return respond({
    ok: true,
    version: VERSION,
    id: body.id,
    original_example:
      existing.original_example,
    status,
    location_type: locationType,
    source: "admin_manual",
    reviewed_by: administrator,
    affected_profiles: Number(
      results[1]?.meta?.changes || 0
    )
  });
}

// ============================================================
// PROFILE RESCAN ADMINISTRATION
// ============================================================

async function adminProfileRescanStatus(env) {
  const status = await getProfileRescanStatus(env);

  return respond({
    ...status,
    admin_api_version: VERSION,
    administrator: ADMIN_ACCOUNT
  });
}

async function adminStartProfileRescan(request, env) {
  // Require an explicit JSON confirmation, so an accidental
  // POST request cannot initiate a full blockchain scan.
  let body;

  try {
    body = await readJsonBody(request);
  } catch {
    return failure(
      "Invalid request body",
      400
    );
  }

  if (
    body.confirm !== true ||
    Object.keys(body).some(
      key => key !== "confirm"
    )
  ) {
    return failure(
      "Explicit confirmation required: {\"confirm\":true}",
      400
    );
  }

  const status = await getProfileRescanStatus(env);

  if (!status.available) {
    return respond({
      ok: false,
      code: "INITIAL_IMPORT_INCOMPLETE",
      error: "Initial profile import is not complete",
      import_complete: false,
      state: status.state
    }, 409);
  }

  if (status.state === "running") {
    return respond({
      ok: false,
      code: "RESCAN_ALREADY_RUNNING",
      error: "A profile rescan is already running",
      job_id: status.job_id,
      started_at: status.started_at,
      state: status.state
    }, 409);
  }

  const result = await startProfileRescan(env);

  if (!result.ok) {
    return respond(
      result,
      409
    );
  }

  return respond({
    ...result,
    admin_api_version: VERSION,
    initiated_by: ADMIN_ACCOUNT,
    message:
      "Profile rescan has been scheduled. Processing will continue in cron batches."
  }, 202);
}

// ============================================================
// ADMINISTRATOR API ROUTER
// ============================================================

export async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (
    path !== "/api/admin" &&
    !path.startsWith("/api/admin/")
  ) {
    return null;
  }

  if (!env.DB) {
    return failure(
      "Administrator database unavailable",
      503
    );
  }

  const routes = {
    "/api/admin/challenge": "POST",
    "/api/admin/login": "POST",
    "/api/admin/session": "GET",
    "/api/admin/logout": "POST",
    "/api/admin/locations/ambiguous": "GET",
    "/api/admin/locations/resolve": "POST",
    "/api/admin/profiles/rescan/status": "GET",
    "/api/admin/profiles/rescan/start": "POST"
  };

  const expectedMethod = routes[path];

  if (!expectedMethod) {
    return failure(
      "Unknown administrator endpoint",
      404
    );
  }

  if (method !== expectedMethod) {
    return respond({
      ok: false,
      error: "Method not allowed"
    }, 405, {
      "Allow": expectedMethod
    });
  }

  if (method === "POST") {
    const validation =
      validateMutationRequest(request);

    if (validation) {
      return validation;
    }
  }

  try {
    switch (path) {
      case "/api/admin/challenge":
        return await createChallenge(env);

      case "/api/admin/login":
        return await login(request, env);

      case "/api/admin/session":
        return await sessionStatus(
          request, env
        );

      case "/api/admin/logout":
        return await logout(
          request, env
        );

      case "/api/admin/locations/ambiguous": {
        const auth = await requireAdminSession(
          request, env
        );

        if (!auth.authorized) {
          return auth.response;
        }

        return await listAmbiguousLocations(
          request, env
        );
      }

      case "/api/admin/locations/resolve": {
        const auth = await requireAdminSession(
          request, env
        );

        if (!auth.authorized) {
          return auth.response;
        }

        return await resolveAmbiguousLocation(
          request,
          env,
          auth.session.account
        );
      }

      case "/api/admin/profiles/rescan/status": {
        const auth = await requireAdminSession(
          request, env
        );

        if (!auth.authorized) {
          return auth.response;
        }

        return await adminProfileRescanStatus(
          env
        );
      }

      case "/api/admin/profiles/rescan/start": {
        const auth = await requireAdminSession(
          request, env
        );

        if (!auth.authorized) {
          return auth.response;
        }

        return await adminStartProfileRescan(
          request, env
        );
      }

      default:
        return failure(
          "Unknown administrator endpoint",
          404
        );
    }
  } catch (error) {
    console.error(
      "[Admin API] Request failed:",
      { path, method, error }
    );

    return failure(
      "Administrator service temporarily unavailable",
      503
    );
  }
}
