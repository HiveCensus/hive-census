
import {
  classifyLocation,
  getClassifierVersion
} from "./location-classifier.js";

import {
  geocodeLocation,
  getGeocoderVersion
} from "./location-geocoder.js";

const VERSION = "0.9.5";
const HIVE_RPC = "https://api.hive.blog";
const CENSUS_ID = "hive_census";
const PROTOCOL_VERSION = 1;

const DEFAULT_MANUAL_SCAN_BLOCKS = 250;
const MAX_MANUAL_SCAN_BLOCKS = 1000;

const SCHEDULED_SCAN_BLOCKS = 250;
const BLOCK_BATCH_SIZE = 100;

const PROFILE_ACCOUNTS_PER_RUN = 100;
const PROFILE_LOOKUP_BATCH_SIZE = 100;
const PROFILE_FETCH_BATCH_SIZE = 100;

const LOCATION_CLASSIFY_PER_RUN = 100;
const GEOCODE_PER_RUN = 10;
const GEOCODE_ERROR_RETRY_HOURS = 24;

// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return jsonResponse({
        ok: true,
        service: "Hive Census",
        version: VERSION,
        database: Boolean(env.DB),
        assets: Boolean(env.ASSETS),
        classifier_version: getClassifierVersion(),
        geocoder_version: getGeocoderVersion(),
        geocoder_configured: Boolean(
          env.GEONAMES_USERNAME
        )
      });
    }

    if (url.pathname === "/api/census") {
      try {
        const result = await env.DB.prepare(`
          SELECT
            account, country, country_name,
            region, region_name, city,
            lat, lon, block_num, trx_id,
            updated_at
          FROM census_current
          ORDER BY country, region, city, account
        `).all();

        return jsonResponse({
          ok: true,
          count: result.results.length,
          accounts: result.results
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/api/indexer/status") {
      try {
        const props = await getDynamicGlobalProperties();

        const cursor = await getMetaNumber(
          env,
          "last_scanned_block",
          110275441
        );

        const lastScheduledRun = await getMeta(
          env,
          "last_scheduled_run"
        );

        const lastSuccessfulScan = await getMeta(
          env,
          "last_successful_scan"
        );

        const lastError = await getMeta(
          env,
          "last_error"
        );

        const lastErrorAt = await getMeta(
          env,
          "last_error_at"
        );

        const irreversible = Number(
          props.last_irreversible_block_num
        );

        const head = Number(
          props.head_block_number
        );

        const blocksBehind = Math.max(
          0,
          irreversible - cursor
        );

        return jsonResponse({
          ok: true,
          version: VERSION,
          indexer_state: determineIndexerState(
            blocksBehind,
            lastScheduledRun,
            lastError,
            lastErrorAt
          ),
          last_scanned_block: cursor,
          head_block_number: head,
          last_irreversible_block_num: irreversible,
          blocks_behind: blocksBehind,
          census_accounts: await countCensusAccounts(env),
          last_scheduled_run: lastScheduledRun,
          last_successful_scan: lastSuccessfulScan,
          last_error: lastError,
          last_error_at: lastErrorAt,
          last_scan_started: await getMeta(
            env,
            "last_scan_started"
          ),
          last_scan_completed: await getMeta(
            env,
            "last_scan_completed"
          ),
          last_scan_blocks: await getMetaNumber(
            env,
            "last_scan_blocks",
            0
          ),
          scheduled_scan_blocks:
            SCHEDULED_SCAN_BLOCKS
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/api/indexer/scan") {
      try {
        const requested = Number(
          url.searchParams.get("blocks") ||
          DEFAULT_MANUAL_SCAN_BLOCKS
        );

        const blocks = Number.isFinite(requested)
          ? Math.min(
              MAX_MANUAL_SCAN_BLOCKS,
              Math.max(1, Math.floor(requested))
            )
          : DEFAULT_MANUAL_SCAN_BLOCKS;

        const result = await scanHive(env, blocks);

        await setMeta(
          env,
          "last_successful_scan",
          new Date().toISOString()
        );

        await clearIndexerError(env);

        return jsonResponse({
          ok: true,
          version: VERSION,
          ...result
        });
      } catch (error) {
        await recordIndexerError(env, error);
        return errorResponse(error);
      }
    }

    if (url.pathname === "/api/profiles/status") {
      try {
        return jsonResponse(
          await getProfileImportStatus(env)
        );
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/api/profiles/locations") {
      try {
        const result = await env.DB.prepare(`
          SELECT
            p.account,
            p.raw_location,
            p.normalized_location,
            p.location_key,
            p.match_status,
            m.status AS location_status,
            m.location_type,
            m.country,
            m.country_name,
            m.region,
            m.region_name,
            m.city,
            m.lat,
            m.lon,
            p.fetched_at
          FROM profile_locations p
          LEFT JOIN location_matches m
            ON m.id = p.match_id
          ORDER BY p.account
          LIMIT 100
        `).all();

        return jsonResponse({
          ok: true,
          version: VERSION,
          count: result.results.length,
          accounts: result.results
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/api/profiles/map") {
      try {
        const result = await env.DB.prepare(`
          SELECT
            m.country,
            m.country_name,
            m.region,
            m.region_name,
            m.city,
            m.lat,
            m.lon,
            m.location_type,
            COUNT(*) AS accounts
          FROM profile_locations p
          JOIN location_matches m
            ON m.id = p.match_id
          WHERE m.status = 'matched'
            AND m.lat IS NOT NULL
            AND m.lon IS NOT NULL
          GROUP BY
            m.country,
            m.country_name,
            m.region,
            m.region_name,
            m.city,
            m.lat,
            m.lon,
            m.location_type
          ORDER BY accounts DESC
        `).all();

        return jsonResponse({
          ok: true,
          version: VERSION,
          count: result.results.length,
          locations: result.results
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (
      url.pathname ===
      "/api/profiles/classifier/status"
    ) {
      try {
        return jsonResponse(
          await getClassifierStatus(env)
        );
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (
      url.pathname ===
      "/api/profiles/geocoder/status"
    ) {
      try {
        return jsonResponse(
          await getGeocoderStatus(env)
        );
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({
        ok: false,
        error: "Unknown API endpoint"
      }, 404);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Hive Census",
      { status: 200 }
    );
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduledJobs(
        env,
        controller.scheduledTime
      )
    );
  }
};

// ============================================================
// SCHEDULED JOBS
// ============================================================

/**
 * Census is always the first job.
 *
 * Only one secondary job runs per Cron execution:
 * classifier -> geocoder -> profiles.
 *
 * The phase is derived from scheduledTime, not
 * a mutable D1 counter, so failed executions do
 * not corrupt the rotation.
 */
async function runScheduledJobs(env, scheduledTime) {
  const auxiliaryJobs = [
    {
      name: "classifier",
      run: () => runScheduledLocationClassifier(env)
    },
    {
      name: "geocoder",
      run: () => runScheduledGeocoder(env)
    },
    {
      name: "profiles",
      run: () => runScheduledProfileImporter(env)
    }
  ];

  const scheduledSlot = Number.isFinite(
    Number(scheduledTime)
  )
    ? Math.floor(Number(scheduledTime) / 300000)
    : Math.floor(Date.now() / 300000);

  const phase = (
    (scheduledSlot % auxiliaryJobs.length) +
    auxiliaryJobs.length
  ) % auxiliaryJobs.length;

  console.log(
    `[Cron] v${VERSION}: starting census`
  );

  /*
   * Census has priority. If indexing fails,
   * secondary work is skipped for this cycle.
   */
  try {
    await runScheduledIndexer(env);

    console.log(
      "[Cron] Census completed"
    );
  } catch (error) {
    console.error(
      "[Cron] Census failed; secondary job skipped:",
      error
    );
    return;
  }

  const job = auxiliaryJobs[phase];

  console.log(
    `[Cron] Starting ${job.name}`
  );

  try {
    await job.run();

    console.log(
      `[Cron] Completed ${job.name}`
    );
  } catch (error) {
    console.error(
      `[Cron] Failed ${job.name}:`,
      error
    );
  }
}

// ============================================================
// CENSUS INDEXER
// ============================================================

async function runScheduledIndexer(env) {
  const startedAt = new Date().toISOString();

  await setMeta(
    env,
    "last_scheduled_run",
    startedAt
  );

  await setMeta(
    env,
    "last_scan_started",
    startedAt
  );

  try {
    const result = await scanHive(
      env,
      SCHEDULED_SCAN_BLOCKS
    );

    const finishedAt = new Date().toISOString();

    await env.DB.batch([
      censusMetaStatement(
        env,
        "last_successful_scan",
        finishedAt
      ),
      censusMetaStatement(
        env,
        "last_scan_completed",
        finishedAt
      ),
      censusMetaStatement(
        env,
        "last_scan_blocks",
        String(result.blocks_scanned)
      ),
      censusMetaStatement(
        env,
        "last_error",
        ""
      ),
      censusMetaStatement(
        env,
        "last_error_at",
        ""
      )
    ]);

    console.log(
      "[Indexer] Scan completed",
      JSON.stringify({
        blocks: result.blocks_scanned,
        cursor: result.last_scanned_block,
        behind: result.blocks_behind,
        census_operations: result.census_operations
      })
    );

    return result;
  } catch (error) {
    await recordIndexerError(env, error);
    throw error;
  }
}

function determineIndexerState(
  blocksBehind,
  lastScheduledRun,
  lastError,
  lastErrorAt
) {
  if (!Number.isFinite(blocksBehind)) {
    return "unknown";
  }

  if (lastScheduledRun) {
    const scheduledTime = Date.parse(lastScheduledRun);

    if (
      Number.isFinite(scheduledTime) &&
      Date.now() - scheduledTime > 15 * 60 * 1000
    ) {
      return "stalled";
    }
  }

  if (lastError && lastErrorAt) {
    const errorTime = Date.parse(lastErrorAt);

    if (
      Number.isFinite(errorTime) &&
      Date.now() - errorTime < 15 * 60 * 1000
    ) {
      return "error";
    }
  }

  if (blocksBehind <= 50) {
    return "synced";
  }

  return "catching_up";
}

async function scanHive(env, requestedBlocks) {
  const props = await getDynamicGlobalProperties();

  const irreversible = Number(
    props.last_irreversible_block_num
  );

  const initialCursor = await getMetaNumber(
    env,
    "last_scanned_block",
    110275441
  );

  const endBlock = Math.min(
    irreversible,
    initialCursor + requestedBlocks
  );

  let cursor = initialCursor;
  let blocksScanned = 0;
  let censusOperations = 0;
  let setsApplied = 0;
  let unsetsApplied = 0;
  let invalidOperations = 0;

  while (cursor < endBlock) {
    const start = cursor + 1;

    const count = Math.min(
      BLOCK_BATCH_SIZE,
      endBlock - cursor
    );

    const blocks = await getBlockRange(
      start,
      count
    );

    if (
      !Array.isArray(blocks) ||
      blocks.length !== count
    ) {
      throw new Error(
        `Incomplete block range at ${start}: expected ${count}, got ${blocks?.length ?? 0}`
      );
    }

    for (
      let index = 0;
      index < blocks.length;
      index++
    ) {
      const block = blocks[index];
      const blockNumber = start + index;

      if (
        !block ||
        !Array.isArray(block.transactions)
      ) {
        throw new Error(
          `Invalid block data at ${blockNumber}`
        );
      }

      for (
        let transactionIndex = 0;
        transactionIndex < block.transactions.length;
        transactionIndex++
      ) {
        const transaction =
          block.transactions[transactionIndex];

        const trxId = getTransactionId(
          block,
          transactionIndex
        );

        for (
          const operation of transaction.operations || []
        ) {
          const parsed = parseOperation(operation);

          if (
            !parsed ||
            parsed.type !== "custom_json" ||
            parsed.value?.id !== CENSUS_ID
          ) {
            continue;
          }

          censusOperations++;

          const account = getPostingAccount(
            parsed.value
          );

          if (!account) {
            invalidOperations++;
            continue;
          }

          let payload;

          try {
            payload =
              typeof parsed.value.json === "string"
                ? JSON.parse(parsed.value.json)
                : parsed.value.json;
          } catch {
            invalidOperations++;
            continue;
          }

          if (isValidSetPayload(payload)) {
            await applySet(
              env,
              account,
              payload,
              blockNumber,
              trxId
            );

            setsApplied++;
          } else if (
            isValidUnsetPayload(payload)
          ) {
            await applyUnset(
              env,
              account,
              blockNumber
            );

            unsetsApplied++;
          } else {
            invalidOperations++;
          }
        }
      }
    }

    cursor = start + count - 1;
    blocksScanned += count;

    await setMeta(
      env,
      "last_scanned_block",
      String(cursor)
    );
  }

  const latestProps =
    await getDynamicGlobalProperties();

  const latestIrreversible = Number(
    latestProps.last_irreversible_block_num
  );

  return {
    previous_cursor: initialCursor,
    last_scanned_block: cursor,
    blocks_scanned: blocksScanned,
    census_operations: censusOperations,
    sets_applied: setsApplied,
    unsets_applied: unsetsApplied,
    invalid_operations: invalidOperations,
    last_irreversible_block_num:
      latestIrreversible,
    blocks_behind: Math.max(
      0,
      latestIrreversible - cursor
    )
  };
}

function parseOperation(operation) {
  if (
    Array.isArray(operation) &&
    operation.length >= 2
  ) {
    return {
      type: normalizeOperationType(operation[0]),
      value: operation[1]
    };
  }

  if (
    operation &&
    typeof operation === "object" &&
    typeof operation.type === "string"
  ) {
    return {
      type: normalizeOperationType(operation.type),
      value: operation.value
    };
  }

  return null;
}

function normalizeOperationType(type) {
  if (typeof type !== "string") {
    return "";
  }

  return type.endsWith("_operation")
    ? type.slice(0, -10)
    : type;
}

function getPostingAccount(value) {
  const postingAuths = value?.required_posting_auths;

  if (
    !Array.isArray(postingAuths) ||
    postingAuths.length !== 1
  ) {
    return null;
  }

  const account = postingAuths[0];

  return (
    typeof account === "string" &&
    account.length > 0
  )
    ? account
    : null;
}

function isValidSetPayload(payload) {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return false;
  }

  if (
    payload.v !== PROTOCOL_VERSION ||
    payload.action !== "set"
  ) {
    return false;
  }

  if (
    typeof payload.country !== "string" ||
    !/^[A-Z]{2}$/.test(payload.country)
  ) {
    return false;
  }

  if (
    typeof payload.country_name !== "string" ||
    !payload.country_name.trim()
  ) {
    return false;
  }

  if (
    typeof payload.city !== "string" ||
    !payload.city.trim()
  ) {
    return false;
  }

  for (
    const field of ["region", "region_name"]
  ) {
    if (
      payload[field] !== undefined &&
      payload[field] !== null &&
      typeof payload[field] !== "string"
    ) {
      return false;
    }
  }

  if (
    typeof payload.lat !== "number" ||
    typeof payload.lon !== "number" ||
    !Number.isFinite(payload.lat) ||
    !Number.isFinite(payload.lon)
  ) {
    return false;
  }

  return (
    payload.lat >= -90 &&
    payload.lat <= 90 &&
    payload.lon >= -180 &&
    payload.lon <= 180
  );
}

function isValidUnsetPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    payload.v === PROTOCOL_VERSION &&
    payload.action === "unset"
  );
}

async function applySet(
  env,
  account,
  payload,
  blockNumber,
  trxId
) {
  await env.DB.prepare(`
    INSERT INTO census_current (
      account, country, country_name,
      region, region_name, city,
      lat, lon, block_num, trx_id,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(account) DO UPDATE SET
      country = excluded.country,
      country_name = excluded.country_name,
      region = excluded.region,
      region_name = excluded.region_name,
      city = excluded.city,
      lat = excluded.lat,
      lon = excluded.lon,
      block_num = excluded.block_num,
      trx_id = excluded.trx_id,
      updated_at = CURRENT_TIMESTAMP
    WHERE excluded.block_num >=
      census_current.block_num
  `).bind(
    account,
    payload.country,
    payload.country_name,
    payload.region ?? null,
    payload.region_name ?? null,
    payload.city,
    payload.lat,
    payload.lon,
    blockNumber,
    trxId
  ).run();
}

async function applyUnset(
  env,
  account,
  blockNumber
) {
  await env.DB.prepare(`
    DELETE FROM census_current
    WHERE account = ?
      AND block_num <= ?
  `).bind(
    account,
    blockNumber
  ).run();
}

function getTransactionId(block, index) {
  const ids = block.transaction_ids;

  return Array.isArray(ids)
    ? ids[index] || null
    : null;
}

// ============================================================
// PROFILE IMPORTER
// ============================================================

async function runScheduledProfileImporter(env) {
  const complete = await getProfileMeta(
    env,
    "import_complete",
    "false"
  );

  if (complete === "true") {
    return;
  }

  try {
    await importProfileBatch(
      env,
      PROFILE_ACCOUNTS_PER_RUN
    );

    await setProfileMeta(
      env,
      "last_import_error",
      ""
    );
  } catch (error) {
    await setProfileMeta(
      env,
      "last_import_error",
      String(error?.message || error)
    );

    throw error;
  }
}

async function importProfileBatch(env, maxAccounts) {
  let lastAccount = await getProfileMeta(
    env,
    "last_account",
    ""
  );

  let scanned = 0;
  let foundLocations = 0;
  let reachedEnd = false;

  while (scanned < maxAccounts) {
    const remaining = maxAccounts - scanned;

    const lookupLimit = Math.min(
      PROFILE_LOOKUP_BATCH_SIZE,
      remaining + (lastAccount ? 1 : 0)
    );

    const names = await lookupHiveAccounts(
      lastAccount,
      lookupLimit
    );

    if (
      !Array.isArray(names) ||
      names.length === 0
    ) {
      reachedEnd = true;
      break;
    }

    const newNames = names.filter(
      name => name > lastAccount
    );

    if (newNames.length === 0) {
      reachedEnd = true;
      break;
    }

    const batchNames = newNames.slice(
      0,
      Math.min(
        PROFILE_FETCH_BATCH_SIZE,
        remaining
      )
    );

    const accounts = await getHiveAccounts(
      batchNames
    );

    if (!Array.isArray(accounts)) {
      throw new Error(
        "Hive get_accounts returned an invalid response"
      );
    }

    const accountsByName = new Map(
      accounts
        .filter(
          account => account && account.name
        )
        .map(
          account => [account.name, account]
        )
    );

    for (const name of batchNames) {
      const account = accountsByName.get(name);

      if (account) {
        const location =
          extractProfileLocation(account);

        if (location) {
          await saveProfileLocation(
            env,
            name,
            location,
            account.last_account_update || null
          );

          foundLocations++;
        }
      }

      scanned++;
      lastAccount = name;

      await setProfileMeta(
        env,
        "last_account",
        lastAccount
      );
    }
  }

  const actualLocations = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM profile_locations
  `).first();

  const alreadyScanned = Number(
    await getProfileMeta(
      env,
      "accounts_scanned",
      "0"
    )
  ) || 0;

  await setProfileMeta(
    env,
    "accounts_scanned",
    String(alreadyScanned + scanned)
  );

  await setProfileMeta(
    env,
    "accounts_with_location",
    String(Number(actualLocations?.count || 0))
  );

  await setProfileMeta(
    env,
    "last_import_run",
    new Date().toISOString()
  );

  if (reachedEnd) {
    await setProfileMeta(
      env,
      "import_complete",
      "true"
    );
  }

  return {
    accounts_scanned_this_run: scanned,
    locations_found_this_run: foundLocations,
    last_account: lastAccount,
    import_complete: reachedEnd
  };
}

async function lookupHiveAccounts(
  lowerBound,
  limit
) {
  const result = await hiveRpc(
    "condenser_api.lookup_accounts",
    [lowerBound, limit]
  );

  if (!Array.isArray(result)) {
    throw new Error(
      "Invalid lookup_accounts response"
    );
  }

  return result.filter(
    name => typeof name === "string"
  );
}

async function getHiveAccounts(names) {
  if (!names.length) {
    return [];
  }

  return hiveRpc(
    "condenser_api.get_accounts",
    [names]
  );
}

function extractProfileLocation(account) {
  const posting = parseAccountMetadata(
    account.posting_json_metadata
  );

  const regular = parseAccountMetadata(
    account.json_metadata
  );

  const candidates = [
    posting?.profile?.location,
    regular?.profile?.location
  ];

  for (const value of candidates) {
    if (typeof value !== "string") {
      continue;
    }

    const location = value.trim();

    if (location.length > 0) {
      return location.slice(0, 500);
    }
  }

  return null;
}

function parseAccountMetadata(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    return (
      parsed &&
      typeof parsed === "object"
    )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeLocation(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function makeLocationKey(value) {
  return normalizeLocation(value)
    .toLocaleLowerCase("en-US");
}

async function saveProfileLocation(
  env,
  account,
  rawLocation,
  lastAccountUpdate
) {
  const normalized = normalizeLocation(
    rawLocation
  );

  const key = makeLocationKey(normalized);

  if (!key) {
    return;
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO location_matches (
      location_key,
      original_example,
      status,
      source
    )
    VALUES (?, ?, 'pending', 'hive_profile')
  `).bind(
    key,
    rawLocation
  ).run();

  await env.DB.prepare(`
    INSERT INTO profile_locations (
      account,
      raw_location,
      normalized_location,
      location_key,
      match_id,
      match_status,
      last_account_update,
      fetched_at
    )
    VALUES (
      ?, ?, ?, ?,
      (
        SELECT id
        FROM location_matches
        WHERE location_key = ?
      ),
      (
        SELECT status
        FROM location_matches
        WHERE location_key = ?
      ),
      ?,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(account) DO UPDATE SET
      raw_location = excluded.raw_location,
      normalized_location =
        excluded.normalized_location,
      location_key = excluded.location_key,
      match_id = excluded.match_id,
      match_status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM profile_location_overrides o
          WHERE o.account = excluded.account
        )
        THEN profile_locations.match_status
        ELSE excluded.match_status
      END,
      last_account_update =
        excluded.last_account_update,
      fetched_at = CURRENT_TIMESTAMP
  `).bind(
    account,
    rawLocation,
    normalized,
    key,
    key,
    key,
    lastAccountUpdate
  ).run();
}

// ============================================================
// LOCAL CLASSIFIER
// ============================================================

async function runScheduledLocationClassifier(env) {
  const startedAt = new Date().toISOString();

  try {
    await setProfileMeta(
      env,
      "last_classifier_started",
      startedAt
    );

    const result = await classifyPendingLocations(
      env,
      LOCATION_CLASSIFY_PER_RUN
    );

    const finishedAt = new Date().toISOString();

    await env.DB.batch([
      metaStatement(
        env, "last_classifier_run", finishedAt
      ),
      metaStatement(
        env, "last_classifier_processed",
        String(result.processed)
      ),
      metaStatement(
        env, "last_classifier_matched",
        String(result.matched)
      ),
      metaStatement(
        env, "last_classifier_ambiguous",
        String(result.ambiguous)
      ),
      metaStatement(
        env, "last_classifier_rejected",
        String(result.rejected)
      ),
      metaStatement(
        env, "last_classifier_error", ""
      )
    ]);

    return result;
  } catch (error) {
    console.error(
      "[Classifier] Execution failed:",
      error
    );

    try {
      await setProfileMeta(
        env,
        "last_classifier_error",
        String(error?.message || error)
      );
    } catch (metadataError) {
      console.error(
        "[Classifier] Cannot save error:",
        metadataError
      );
    }

    throw error;
  }
}

async function classifyPendingLocations(
  env,
  limit
) {
  const pending = await env.DB.prepare(`
    SELECT id, original_example
    FROM location_matches
    WHERE status = 'pending'
    ORDER BY id
    LIMIT ?
  `).bind(limit).all();

  let matched = 0;
  let ambiguous = 0;
  let rejected = 0;

  for (const row of pending.results) {
    const classification = classifyLocation(
      row.original_example
    );

    if (
      !["matched", "ambiguous", "rejected"]
        .includes(classification.status)
    ) {
      throw new Error(
        `Invalid classification for location ID ${row.id}`
      );
    }

    await env.DB.prepare(`
      UPDATE location_matches
      SET
        status = ?,
        location_type = COALESCE(
          ?, location_type
        ),
        country = ?,
        country_name = ?,
        region = ?,
        region_name = ?,
        city = ?,
        lat = ?,
        lon = ?,
        confidence = ?,
        source = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND status = 'pending'
    `).bind(
      classification.status,
      classification.location_type,
      classification.country,
      classification.country_name,
      classification.region,
      classification.region_name,
      classification.city,
      classification.lat,
      classification.lon,
      classification.confidence,
      classification.source,
      row.id
    ).run();

    if (classification.status === "matched") {
      matched++;
    } else if (
      classification.status === "ambiguous"
    ) {
      ambiguous++;
    } else {
      rejected++;
    }
  }

  await synchronizeProfileMatchStatuses(env);

  return {
    processed: pending.results.length,
    matched,
    ambiguous,
    rejected
  };
}

// ============================================================
// GEONAMES GEOCODER
// ============================================================

async function runScheduledGeocoder(env) {
  const startedAt = new Date().toISOString();

  try {
    await setProfileMeta(
      env,
      "last_geocoder_started",
      startedAt
    );

    if (!env.GEONAMES_USERNAME) {
      throw new Error(
        "GEONAMES_USERNAME is not configured"
      );
    }

    const result = await geocodeAmbiguousLocations(
      env,
      GEOCODE_PER_RUN
    );

    await env.DB.batch([
      metaStatement(
        env,
        "last_geocoder_run",
        new Date().toISOString()
      ),
      metaStatement(
        env,
        "last_geocoder_processed",
        String(result.processed)
      ),
      metaStatement(
        env,
        "last_geocoder_matched",
        String(result.matched)
      ),
      metaStatement(
        env,
        "last_geocoder_ambiguous",
        String(result.ambiguous)
      ),
      metaStatement(
        env,
        "last_geocoder_rejected",
        String(result.rejected)
      ),
      metaStatement(
        env,
        "last_geocoder_errors",
        String(result.errors)
      ),
      metaStatement(
        env,
        "last_geocoder_error",
        ""
      )
    ]);

    return result;
  } catch (error) {
    console.error(
      "[Geocoder] Execution failed:",
      error
    );

    try {
      await setProfileMeta(
        env,
        "last_geocoder_error",
        String(error?.message || error)
      );
    } catch (metadataError) {
      console.error(
        "[Geocoder] Cannot save error:",
        metadataError
      );
    }

    throw error;
  }
}

async function geocodeAmbiguousLocations(
  env,
  limit
) {
  const retryBefore = new Date(
    Date.now() -
    GEOCODE_ERROR_RETRY_HOURS * 3600000
  ).toISOString();

  const candidates = await env.DB.prepare(`
    SELECT
      m.id,
      m.location_key,
      m.original_example
    FROM location_matches m
    LEFT JOIN location_geocode_attempts a
      ON a.location_key = m.location_key
    WHERE m.status = 'ambiguous'
      AND (
        a.location_key IS NULL
        OR (
          a.outcome = 'error'
          AND a.attempted_at < ?
        )
      )
    ORDER BY m.id
    LIMIT ?
  `).bind(
    retryBefore,
    limit
  ).all();

  let matched = 0;
  let ambiguous = 0;
  let rejected = 0;
  let errors = 0;

  for (const row of candidates.results) {
    try {
      const result = await geocodeLocation(
        row.original_example,
        env.GEONAMES_USERNAME
      );

      const safeResult = isSafeGeocoderMatch(
        row.original_example,
        result
      );

      console.log(
        "[Geocoder] Result",
        JSON.stringify({
          location: row.original_example,
          geocoder_status: result.status,
          geocoder_reason: result.reason || null,
          final_status: safeResult.status,
          final_reason: safeResult.reason || null,
          location_type:
            safeResult.location_type || null,
          country: safeResult.country || null,
          city: safeResult.city || null
        })
      );

      if (safeResult.status === "matched") {
        await env.DB.prepare(`
          UPDATE location_matches
          SET
            status = 'matched',
            location_type = ?,
            country = ?,
            country_name = ?,
            region = ?,
            region_name = ?,
            city = ?,
            lat = ?,
            lon = ?,
            confidence = ?,
            source = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'ambiguous'
        `).bind(
          safeResult.location_type,
          safeResult.country,
          safeResult.country_name,
          safeResult.region,
          safeResult.region_name,
          safeResult.city,
          safeResult.lat,
          safeResult.lon,
          safeResult.confidence,
          safeResult.source,
          row.id
        ).run();

        matched++;
      } else if (
        safeResult.status === "rejected"
      ) {
        await env.DB.prepare(`
          UPDATE location_matches
          SET
            status = 'rejected',
            source = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'ambiguous'
        `).bind(
          safeResult.source || "geonames_v4",
          row.id
        ).run();

        rejected++;
      } else {
        ambiguous++;
      }

      await recordGeocodeAttempt(
        env,
        row.location_key,
        safeResult.status,
        null
      );
    } catch (error) {
      errors++;

      await recordGeocodeAttempt(
        env,
        row.location_key,
        "error",
        String(error?.message || error)
      );

      console.error(
        `[Geocoder] Failed ${row.location_key}:`,
        error
      );

      break;
    }
  }

  await synchronizeProfileMatchStatuses(env);

  return {
    processed:
      matched + ambiguous + rejected + errors,
    matched,
    ambiguous,
    rejected,
    errors
  };
}

function isSafeGeocoderMatch(
  rawLocation,
  result
) {
  if (result.status !== "matched") {
    return result;
  }

  const ambiguousResult = {
    ...result,
    status: "ambiguous",
    reason: "requires_manual_review"
  };

  if (
    !["locality", "country_proxy", "region_proxy"]
      .includes(result.location_type)
  ) {
    return ambiguousResult;
  }

  if (
    !result.country ||
    !Number.isFinite(Number(result.lat)) ||
    !Number.isFinite(Number(result.lon)) ||
    result.confidence !== 1
  ) {
    return ambiguousResult;
  }

  if (result.location_type === "country_proxy") {
    return result.reason === "country_capital_proxy"
      ? result
      : ambiguousResult;
  }

  if (result.location_type === "region_proxy") {
    const verifiedRegionCapital =
      result.reason === "region_capital_proxy" &&
      typeof result.region_name === "string" &&
      result.region_name.trim().length > 0 &&
      typeof result.city === "string" &&
      result.city.trim().length > 0;

    /*
     * Region code may be null for countries
     * whose GeoNames admin codes have not
     * been independently verified.
     *
     * The country and named region remain
     * mandatory.
     */
    return verifiedRegionCapital
      ? result
      : ambiguousResult;
  }

  if (!result.city) {
    return ambiguousResult;
  }

  const normalize = value =>
    String(value || "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");

  const original = normalize(rawLocation);
  const city = normalize(result.city);

  if (
    original !== city &&
    !original.startsWith(city + " ")
  ) {
    return ambiguousResult;
  }

  return result;
}

async function recordGeocodeAttempt(
  env,
  locationKey,
  outcome,
  errorMessage
) {
  await env.DB.prepare(`
    INSERT INTO location_geocode_attempts (
      location_key,
      provider,
      attempted_at,
      outcome,
      error_message
    )
    VALUES (
      ?,
      'geonames',
      CURRENT_TIMESTAMP,
      ?,
      ?
    )
    ON CONFLICT(location_key)
    DO UPDATE SET
      provider = excluded.provider,
      attempted_at = excluded.attempted_at,
      outcome = excluded.outcome,
      error_message = excluded.error_message
  `).bind(
    locationKey,
    outcome,
    errorMessage
  ).run();
}

async function synchronizeProfileMatchStatuses(env) {
  await env.DB.prepare(`
    UPDATE profile_locations
    SET match_status = (
      SELECT m.status
      FROM location_matches m
      WHERE m.id = profile_locations.match_id
    )
    WHERE match_id IN (
      SELECT id
      FROM location_matches
      WHERE status != 'pending'
    )
    AND match_status != (
      SELECT m.status
      FROM location_matches m
      WHERE m.id = profile_locations.match_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM profile_location_overrides o
      WHERE o.account = profile_locations.account
    )
  `).run();
}

// ============================================================
// STATUS ENDPOINTS
// ============================================================

async function getProfileImportStatus(env) {
  const metaResult = await env.DB.prepare(`
    SELECT key, value
    FROM profile_import_meta
  `).all();

  const meta = Object.fromEntries(
    metaResult.results.map(
      row => [row.key, row.value]
    )
  );

  const counts = await env.DB.prepare(`
    SELECT
      (
        SELECT COUNT(*)
        FROM profile_locations
      ) AS stored_profile_locations,
      (
        SELECT COUNT(*)
        FROM location_matches
      ) AS unique_location_strings,
      (
        SELECT COUNT(*)
        FROM location_matches
        WHERE status = 'pending'
      ) AS pending_location_matches
  `).first();

  return {
    ok: true,
    version: VERSION,
    import_complete:
      meta.import_complete === "true",
    last_account: meta.last_account || "",
    accounts_scanned: Number(
      meta.accounts_scanned || 0
    ),
    accounts_with_location: Number(
      counts?.stored_profile_locations || 0
    ),
    stored_profile_locations: Number(
      counts?.stored_profile_locations || 0
    ),
    unique_location_strings: Number(
      counts?.unique_location_strings || 0
    ),
    pending_location_matches: Number(
      counts?.pending_location_matches || 0
    ),
    last_import_run: meta.last_import_run || "",
    last_import_error: meta.last_import_error || "",
    accounts_per_scheduled_run:
      PROFILE_ACCOUNTS_PER_RUN
  };
}

async function getClassifierStatus(env) {
  const counts = await env.DB.prepare(`
    SELECT
      status,
      location_type,
      COUNT(*) AS count
    FROM location_matches
    GROUP BY status, location_type
    ORDER BY status, location_type
  `).all();

  const meta = await getMetaByPrefix(
    env,
    "last_classifier_%"
  );

  return {
    ok: true,
    version: VERSION,
    classifier_version: getClassifierVersion(),
    last_classifier_started:
      meta.last_classifier_started || "",
    last_classifier_run:
      meta.last_classifier_run || "",
    last_classifier_error:
      meta.last_classifier_error || "",
    last_classifier_processed: Number(
      meta.last_classifier_processed || 0
    ),
    last_classifier_matched: Number(
      meta.last_classifier_matched || 0
    ),
    last_classifier_ambiguous: Number(
      meta.last_classifier_ambiguous || 0
    ),
    last_classifier_rejected: Number(
      meta.last_classifier_rejected || 0
    ),
    locations_per_scheduled_run:
      LOCATION_CLASSIFY_PER_RUN,
    counts: counts.results
  };
}

async function getGeocoderStatus(env) {
  const meta = await getMetaByPrefix(
    env,
    "last_geocoder_%"
  );

  const attempts = await env.DB.prepare(`
    SELECT
      outcome,
      COUNT(*) AS count
    FROM location_geocode_attempts
    GROUP BY outcome
    ORDER BY outcome
  `).all();

  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM location_matches m
    LEFT JOIN location_geocode_attempts a
      ON a.location_key = m.location_key
    WHERE m.status = 'ambiguous'
      AND a.location_key IS NULL
  `).first();

  return {
    ok: true,
    version: VERSION,
    geocoder_version: getGeocoderVersion(),
    configured: Boolean(env.GEONAMES_USERNAME),
    last_geocoder_started:
      meta.last_geocoder_started || "",
    last_geocoder_run:
      meta.last_geocoder_run || "",
    last_geocoder_error:
      meta.last_geocoder_error || "",
    last_geocoder_processed: Number(
      meta.last_geocoder_processed || 0
    ),
    last_geocoder_matched: Number(
      meta.last_geocoder_matched || 0
    ),
    last_geocoder_ambiguous: Number(
      meta.last_geocoder_ambiguous || 0
    ),
    last_geocoder_rejected: Number(
      meta.last_geocoder_rejected || 0
    ),
    last_geocoder_errors: Number(
      meta.last_geocoder_errors || 0
    ),
    requests_per_scheduled_run:
      GEOCODE_PER_RUN,
    error_retry_hours:
      GEOCODE_ERROR_RETRY_HOURS,
    remaining_untried_ambiguous: Number(
      remaining?.count || 0
    ),
    attempts: attempts.results
  };
}

async function getMetaByPrefix(env, pattern) {
  const result = await env.DB.prepare(`
    SELECT key, value
    FROM profile_import_meta
    WHERE key LIKE ?
  `).bind(pattern).all();

  return Object.fromEntries(
    result.results.map(
      row => [row.key, row.value]
    )
  );
}

// ============================================================
// HIVE RPC
// ============================================================

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
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Hive RPC HTTP ${response.status}: ${method}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Hive RPC ${method}: ${JSON.stringify(data.error)}`
    );
  }

  if (
    data.result === undefined ||
    data.result === null
  ) {
    throw new Error(
      `Hive RPC returned no result: ${method}`
    );
  }

  return data.result;
}

async function getDynamicGlobalProperties() {
  return hiveRpc(
    "condenser_api.get_dynamic_global_properties",
    []
  );
}

async function getBlockRange(startBlock, count) {
  const result = await hiveRpc(
    "block_api.get_block_range",
    {
      starting_block_num: startBlock,
      count
    }
  );

  return result.blocks;
}

// ============================================================
// DATABASE METADATA
// ============================================================

async function getMeta(env, key) {
  const row = await env.DB.prepare(`
    SELECT value
    FROM census_meta
    WHERE key = ?
  `).bind(key).first();

  return row?.value ?? "";
}

async function getMetaNumber(
  env,
  key,
  fallback
) {
  const value = await getMeta(env, key);

  if (value === "") {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function censusMetaStatement(
  env,
  key,
  value
) {
  return env.DB.prepare(`
    INSERT INTO census_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).bind(
    key,
    String(value)
  );
}

async function setMeta(env, key, value) {
  await censusMetaStatement(
    env,
    key,
    value
  ).run();
}

async function getProfileMeta(
  env,
  key,
  fallback = ""
) {
  const row = await env.DB.prepare(`
    SELECT value
    FROM profile_import_meta
    WHERE key = ?
  `).bind(key).first();

  return row?.value ?? fallback;
}

function metaStatement(env, key, value) {
  return env.DB.prepare(`
    INSERT INTO profile_import_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `).bind(
    key,
    String(value)
  );
}

async function setProfileMeta(
  env,
  key,
  value
) {
  await metaStatement(
    env,
    key,
    value
  ).run();
}

async function countCensusAccounts(env) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM census_current
  `).first();

  return Number(row?.count || 0);
}

async function recordIndexerError(
  env,
  error
) {
  await setMeta(
    env,
    "last_error",
    String(error?.message || error)
  );

  await setMeta(
    env,
    "last_error_at",
    new Date().toISOString()
  );
}

async function clearIndexerError(env) {
  await setMeta(env, "last_error", "");
  await setMeta(env, "last_error_at", "");
}

// ============================================================
// HTTP RESPONSES
// ============================================================

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

function errorResponse(error) {
  console.error(error);

  return jsonResponse(
    {
      ok: false,
      version: VERSION,
      error: String(error?.message || error)
    },
    500
  );
}
