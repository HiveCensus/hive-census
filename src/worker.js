
/*
 * Hive Census — Worker entry point
 *
 * Version 0.9.6
 *
 * Responsibilities:
 * - Administrator authentication API
 * - Protection of manual indexer scans
 * - Delegation to the existing Census Worker
 * - Preservation of scheduled Cron jobs
 *
 * The original v0.9.5 implementation lives in:
 * ./worker-core.js
 */

import censusWorker from "./worker-core.js";

import {
  handleAdminApi,
  requireAdminSession
} from "./admin-api.js";

const VERSION = "0.9.6";

const MANUAL_SCAN_PATH = "/api/indexer/scan";

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers
      }
    }
  );
}

function isSameOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return false;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    const suppliedOrigin = new URL(origin).origin;

    return (
      suppliedOrigin === requestOrigin &&
      new URL(request.url).protocol === "https:"
    );
  } catch {
    return false;
  }
}

/*
 * The original Worker exposes a GET endpoint
 * that performs a manual blockchain scan.
 *
 * This entry point intercepts that endpoint
 * before the request reaches worker-core.js.
 *
 * Only an authenticated administrator may
 * trigger it, using a same-origin POST.
 */

async function handleManualScan(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: "Method not allowed"
      },
      405,
      {
        Allow: "POST"
      }
    );
  }

  if (!isSameOrigin(request)) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid request origin"
      },
      403
    );
  }

  const authorization = await requireAdminSession(
    request,
    env
  );

  if (!authorization.authorized) {
    return authorization.response;
  }

  /*
   * The old implementation expects GET.
   *
   * The method is changed only after:
   * 1. Checking the original method.
   * 2. Checking the request origin.
   * 3. Verifying the administrator session.
   *
   * This internal delegation does not
   * expose the legacy GET endpoint publicly.
   */

  const internalRequest = new Request(
    request.url,
    {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    }
  );

  const response = await censusWorker.fetch(
    internalRequest,
    env,
    ctx
  );

  /*
   * Legacy responses may include permissive
   * CORS headers. Remove them from this
   * administrator-only operation.
   */

  const headers = new Headers(response.headers);

  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Credentials");

  headers.set(
    "Cache-Control",
    "no-store"
  );

  headers.set(
    "X-Content-Type-Options",
    "nosniff"
  );

  return new Response(
    response.body,
    {
      status: response.status,
      statusText: response.statusText,
      headers
    }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /*
     * Administrator authentication endpoints.
     *
     * These are handled before any public
     * routes or static assets.
     */

    if (
      url.pathname === "/api/admin" ||
      url.pathname.startsWith("/api/admin/")
    ) {
      return handleAdminApi(request, env);
    }

    /*
     * Protect the existing manual scan.
     *
     * No unauthenticated request can reach
     * the old scan implementation.
     */

    if (url.pathname === MANUAL_SCAN_PATH) {
      return handleManualScan(
        request,
        env,
        ctx
      );
    }

    /*
     * All other routes retain the existing
     * v0.9.5 implementation.
     */

    return censusWorker.fetch(
      request,
      env,
      ctx
    );
  },

  /*
   * Keep the existing scheduled jobs:
   *
   * - Census blockchain indexing
   * - Profile importing
   * - Location classification
   * - GeoNames geocoding
   *
   * No changes to the Cron rotation.
   */

  async scheduled(controller, env, ctx) {
    return censusWorker.scheduled(
      controller,
      env,
      ctx
    );
  }
};
