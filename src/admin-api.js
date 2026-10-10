
/*
 * Hive Census — Administrator API
 *
 * Authentication:
 * - Hive Keychain posting signature
 * - One-time D1 challenges
 * - Hive blockchain authority verification
 * - HttpOnly session cookies
 *
 * Location Review:
 * - Authenticated ambiguous-location queue
 * - Read-only in this version
 *
 * Administrative write operations will be
 * implemented after validating the review queue.
 */

import {
  ADMIN_ACCOUNT,
  ADMIN_SESSION_TTL_MS,
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

const HIVE_RPC = "https://api.hive.blog";

const MAX_BODY_BYTES = 8192;
const MAX_SIGNATURE_LENGTH = 256;

const DEFAULT_REVIEW_LIMIT = 50;
const MAX_REVIEW_LIMIT = 100;

const SECURITY_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

function respond(data, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...SECURITY_HEADERS,
        ...extraHeaders
      }
    }
  );
}

function failure(message, status = 400) {
  return respond({
    ok: false,
    error: message
  }, status);
}

function requestIsSameOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return false;
  }

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
    return failure(
      "Invalid request origin",
      403
    );
  }

  const contentType = request.headers.get(
    "Content-Type"
  ) || "";

  if (
    !/^application\/json(?:\s*;|$)/i.test(
      contentType
    )
  ) {
    return failure(
      "Content-Type must be application/json",
      415
    );
  }

  return null;
}

async function readJsonBody(request) {
  const contentLength = Number(
    request.headers.get("Content-Length")
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BODY_BYTES
  ) {
    throw new Error("Request body too large");
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
  const response = await fetch(
    HIVE_RPC,
    {
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
    }
  );

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

async function createChallenge(env) {
  const challenge = createAdminChallenge();

  await env.DB.prepare(`
    INSERT INTO admin_auth_challenges (
      nonce,
      account,
      message,
      expires_at
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
    return failure("Invalid authentication data");
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
    !validateAdminChallenge(
      challenge,
      nonce
    )
  ) {
    return failure(
      "Authentication challenge expired or invalid",
      401
    );
  }

  /*
   * Account authorities come directly
   * from Hive RPC, never from the client.
   */
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

  /*
   * Consume the challenge conditionally.
   *
   * D1 executes this UPDATE atomically.
   * Only one concurrent login can claim
   * the challenge.
   */
  const consumed = await env.DB.prepare(`
    UPDATE admin_auth_challenges
    SET consumed_at = CURRENT_TIMESTAMP
    WHERE nonce = ?
      AND account = ?
      AND consumed_at IS NULL
      AND julianday(expires_at) >
          julianday('now')
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
  const tokenHash =
    await hashAdminSessionToken(token);

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

  return respond(
    {
      ok: true,
      authenticated: true,
      account: ADMIN_ACCOUNT,
      expires_at: expiresAt
    },
    200,
    {
      "Set-Cookie":
        createAdminSessionCookie(token)
    }
  );
}

export async function getAdminSession(
  request,
  env
) {
  const token = readAdminSessionCookie(request);

  if (!token) {
    return null;
  }

  const tokenHash =
    await hashAdminSessionToken(token);

  const session = await env.DB.prepare(`
    SELECT
      account,
      created_at,
      expires_at
    FROM admin_sessions
    WHERE token_hash = ?
      AND account = ?
      AND revoked_at IS NULL
      AND julianday(expires_at) >
          julianday('now')
  `).bind(
    tokenHash,
    ADMIN_ACCOUNT
  ).first();

  if (!session) {
    return null;
  }

  return {
    account: session.account,
    created_at: session.created_at,
    expires_at: session.expires_at
  };
}

async function sessionStatus(request, env) {
  const session = await getAdminSession(
    request,
    env
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

  return respond(
    {
      ok: true,
      authenticated: false
    },
    200,
    {
      "Set-Cookie":
        clearAdminSessionCookie()
    }
  );
}

// ============================================================
// LOCATION REVIEW — READ-ONLY
// ============================================================

async function listAmbiguousLocations(
  request,
  env
) {
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

  const offset = Number.isSafeInteger(
    requestedOffset
  ) && requestedOffset >= 0
    ? requestedOffset
    : 0;

  /*
   * One row represents one distinct
   * normalized location string.
   *
   * The account count helps prioritize
   * manual review.
   *
   * Account-specific overrides are excluded
   * from the count because they must not be
   * overwritten by a global decision.
   */
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
      )
    WHERE m.status = 'ambiguous'
    GROUP BY m.id
    ORDER BY
      affected_accounts DESC,
      m.id ASC
    LIMIT ? OFFSET ?
  `).bind(
    limit,
    offset
  ).all();

  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM location_matches
    WHERE status = 'ambiguous'
  `).first();

  const total = Number(
    countRow?.total || 0
  );

  return respond({
    ok: true,
    version: "0.1.0",
    account: ADMIN_ACCOUNT,
    total,
    limit,
    offset,
    count: result.results.length,
    has_more: offset + result.results.length < total,
    locations: result.results
  });
}

/*
 * Called from the main Worker before
 * the regular public API routes.
 *
 * Returns:
 * - Response for handled admin requests
 * - null for non-admin requests
 */
export async function handleAdminApi(
  request,
  env
) {
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
    "/api/admin/locations/ambiguous": "GET"
  };

  const expectedMethod = routes[path];

  if (!expectedMethod) {
    return failure(
      "Unknown administrator endpoint",
      404
    );
  }

  if (method !== expectedMethod) {
    return respond(
      {
        ok: false,
        error: "Method not allowed"
      },
      405,
      {
        "Allow": expectedMethod
      }
    );
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
          request,
          env
        );

      case "/api/admin/logout":
        return await logout(
          request,
          env
        );

      case "/api/admin/locations/ambiguous": {
        const auth = await requireAdminSession(
          request,
          env
        );

        if (!auth.authorized) {
          return auth.response;
        }

        return await listAmbiguousLocations(
          request,
          env
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
      error
    );

    return failure(
      "Administrator service temporarily unavailable",
      503
    );
  }
}

export async function requireAdminSession(
  request,
  env
) {
  const session = await getAdminSession(
    request,
    env
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
