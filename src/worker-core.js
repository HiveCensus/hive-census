import { classifyLocation, getClassifierVersion } from "./location-classifier.js";
import { geocodeLocation, getGeocoderVersion } from "./location-geocoder.js";

const VERSION = "0.9.10";
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
const PROFILE_LEASE_SECONDS = 240;

// ============================================================
// WORKER
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") return jsonResponse({
      ok: true, service: "Hive Census", version: VERSION,
      database: Boolean(env.DB), assets: Boolean(env.ASSETS),
      classifier_version: getClassifierVersion(),
      geocoder_version: getGeocoderVersion(),
      geocoder_configured: Boolean(env.GEONAMES_USERNAME)
    });
    try {
      if (url.pathname === "/api/census") {
        const result = await env.DB.prepare(`SELECT account, country, country_name, region, region_name, city, lat, lon, block_num, trx_id, updated_at FROM census_current ORDER BY country, region, city, account`).all();
        return jsonResponse({ ok: true, count: result.results.length, accounts: result.results });
      }
      if (url.pathname === "/api/indexer/status") {
        const props = await getDynamicGlobalProperties();
        const cursor = await getMetaNumber(env, "last_scanned_block", 110275441);
        const lastScheduledRun = await getMeta(env, "last_scheduled_run");
        const lastSuccessfulScan = await getMeta(env, "last_successful_scan");
        const lastError = await getMeta(env, "last_error");
        const lastErrorAt = await getMeta(env, "last_error_at");
        const irreversible = Number(props.last_irreversible_block_num);
        const head = Number(props.head_block_number);
        const blocksBehind = Math.max(0, irreversible - cursor);
        return jsonResponse({
          ok: true, version: VERSION,
          indexer_state: determineIndexerState(blocksBehind, lastScheduledRun, lastError, lastErrorAt),
          last_scanned_block: cursor, head_block_number: head,
          last_irreversible_block_num: irreversible, blocks_behind: blocksBehind,
          census_accounts: await countCensusAccounts(env),
          last_scheduled_run: lastScheduledRun, last_successful_scan: lastSuccessfulScan,
          last_error: lastError, last_error_at: lastErrorAt,
          last_scan_started: await getMeta(env, "last_scan_started"),
          last_scan_completed: await getMeta(env, "last_scan_completed"),
          last_scan_blocks: await getMetaNumber(env, "last_scan_blocks", 0),
          scheduled_scan_blocks: SCHEDULED_SCAN_BLOCKS
        });
      }
      if (url.pathname === "/api/indexer/scan") {
        try {
          const requested = Number(url.searchParams.get("blocks") || DEFAULT_MANUAL_SCAN_BLOCKS);
          const blocks = Number.isFinite(requested) ? Math.min(MAX_MANUAL_SCAN_BLOCKS, Math.max(1, Math.floor(requested))) : DEFAULT_MANUAL_SCAN_BLOCKS;
          const result = await scanHive(env, blocks);
          await setMeta(env, "last_successful_scan", new Date().toISOString());
          await clearIndexerError(env);
          return jsonResponse({ ok: true, version: VERSION, ...result });
        } catch (error) {
          await recordIndexerError(env, error);
          throw error;
        }
      }
      if (url.pathname === "/api/profiles/status") return jsonResponse(await getProfileImportStatus(env));
      if (url.pathname === "/api/profiles/locations") {
        const result = await env.DB.prepare(`
          SELECT p.account, p.raw_location, p.normalized_location, p.location_key,
                 p.match_status, m.status AS location_status, m.location_type,
                 m.country, m.country_name, m.region, m.region_name, m.city,
                 m.lat, m.lon, p.fetched_at
          FROM profile_locations p LEFT JOIN location_matches m ON m.id = p.match_id
          ORDER BY p.account LIMIT 100
        `).all();
        return jsonResponse({ ok: true, version: VERSION, count: result.results.length, accounts: result.results });
      }
      if (url.pathname === "/api/profiles/map") {
        const result = await env.DB.prepare(`
          SELECT m.country, m.country_name, m.region, m.region_name, m.city,
                 m.lat, m.lon, m.location_type, COUNT(*) AS accounts
          FROM profile_locations p JOIN location_matches m ON m.id = p.match_id
          WHERE p.match_status = 'matched' AND m.status = 'matched'
            AND m.lat IS NOT NULL AND m.lon IS NOT NULL
          GROUP BY m.country, m.country_name, m.region, m.region_name,
                   m.city, m.lat, m.lon, m.location_type
          ORDER BY accounts DESC
        `).all();
        return jsonResponse({ ok: true, version: VERSION, count: result.results.length, locations: result.results });
      }
      if (url.pathname === "/api/profiles/classifier/status") return jsonResponse(await getClassifierStatus(env));
      if (url.pathname === "/api/profiles/geocoder/status") return jsonResponse(await getGeocoderStatus(env));
      if (url.pathname === "/api/profiles/rescan/status") return jsonResponse(await getProfileRescanStatus(env));
    } catch (error) { return errorResponse(error); }
    if (url.pathname.startsWith("/api/")) return jsonResponse({ ok: false, error: "Unknown API endpoint" }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Hive Census", { status: 200 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledJobs(env, controller.scheduledTime));
  }
};

// ============================================================
// SCHEDULED JOBS
// ============================================================
async function runScheduledJobs(env, scheduledTime) {
  const auxiliaryJobs = [
    { name: "classifier", run: () => runScheduledLocationClassifier(env) },
    { name: "geocoder", run: () => runScheduledGeocoder(env) },
    { name: "profiles", run: () => runScheduledProfileImporter(env) }
  ];
  const slot = Number.isFinite(Number(scheduledTime))
    ? Math.floor(Number(scheduledTime) / 300000)
    : Math.floor(Date.now() / 300000);
  const phase = ((slot % auxiliaryJobs.length) + auxiliaryJobs.length) % auxiliaryJobs.length;
  console.log(`[Cron] v${VERSION}: starting census`);
  try { await runScheduledIndexer(env); }
  catch (error) { console.error("[Cron] Census failed; secondary job skipped:", error); return; }
  const job = auxiliaryJobs[phase];
  try { await job.run(); console.log(`[Cron] Completed ${job.name}`); }
  catch (error) { console.error(`[Cron] Failed ${job.name}:`, error); }
}

// ============================================================
// CENSUS INDEXER (existing behaviour retained)
// ============================================================
async function runScheduledIndexer(env) {
  const startedAt = new Date().toISOString();
  await setMeta(env, "last_scheduled_run", startedAt);
  await setMeta(env, "last_scan_started", startedAt);
  try {
    const result = await scanHive(env, SCHEDULED_SCAN_BLOCKS);
    const finishedAt = new Date().toISOString();
    await env.DB.batch([
      censusMetaStatement(env, "last_successful_scan", finishedAt),
      censusMetaStatement(env, "last_scan_completed", finishedAt),
      censusMetaStatement(env, "last_scan_blocks", String(result.blocks_scanned)),
      censusMetaStatement(env, "last_error", ""),
      censusMetaStatement(env, "last_error_at", "")
    ]);
    console.log("[Indexer] Scan completed", JSON.stringify(result));
    return result;
  } catch (error) { await recordIndexerError(env, error); throw error; }
}
function determineIndexerState(blocksBehind, lastScheduledRun, lastError, lastErrorAt) {
  if (!Number.isFinite(blocksBehind)) return "unknown";
  if (lastScheduledRun) {
    const time = Date.parse(lastScheduledRun);
    if (Number.isFinite(time) && Date.now() - time > 15 * 60 * 1000) return "stalled";
  }
  if (lastError && lastErrorAt) {
    const time = Date.parse(lastErrorAt);
    if (Number.isFinite(time) && Date.now() - time < 15 * 60 * 1000) return "error";
  }
  return blocksBehind <= 50 ? "synced" : "catching_up";
}
async function scanHive(env, requestedBlocks) {
  const props = await getDynamicGlobalProperties();
  const irreversible = Number(props.last_irreversible_block_num);
  const initialCursor = await getMetaNumber(env, "last_scanned_block", 110275441);
  const endBlock = Math.min(irreversible, initialCursor + requestedBlocks);
  let cursor = initialCursor, blocksScanned = 0, censusOperations = 0;
  let setsApplied = 0, unsetsApplied = 0, invalidOperations = 0;
  while (cursor < endBlock) {
    const start = cursor + 1;
    const count = Math.min(BLOCK_BATCH_SIZE, endBlock - cursor);
    const blocks = await getBlockRange(start, count);
    if (!Array.isArray(blocks) || blocks.length !== count)
      throw new Error(`Incomplete block range at ${start}: expected ${count}, got ${blocks?.length ?? 0}`);
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index], blockNumber = start + index;
      if (!block || !Array.isArray(block.transactions)) throw new Error(`Invalid block data at ${blockNumber}`);
      for (let transactionIndex = 0; transactionIndex < block.transactions.length; transactionIndex++) {
        const transaction = block.transactions[transactionIndex];
        const trxId = getTransactionId(block, transactionIndex);
        for (const operation of transaction.operations || []) {
          const parsed = parseOperation(operation);
          if (!parsed || parsed.type !== "custom_json" || parsed.value?.id !== CENSUS_ID) continue;
          censusOperations++;
          const account = getPostingAccount(parsed.value);
          if (!account) { invalidOperations++; continue; }
          let payload;
          try { payload = typeof parsed.value.json === "string" ? JSON.parse(parsed.value.json) : parsed.value.json; }
          catch { invalidOperations++; continue; }
          if (isValidSetPayload(payload)) {
            await applySet(env, account, payload, blockNumber, trxId); setsApplied++;
          } else if (isValidUnsetPayload(payload)) {
            await applyUnset(env, account, blockNumber); unsetsApplied++;
          } else invalidOperations++;
        }
      }
    }
    cursor = start + count - 1;
    blocksScanned += count;
    await setMeta(env, "last_scanned_block", String(cursor));
  }
  const latestProps = await getDynamicGlobalProperties();
  const latestIrreversible = Number(latestProps.last_irreversible_block_num);
  return {
    previous_cursor: initialCursor, last_scanned_block: cursor,
    blocks_scanned: blocksScanned, census_operations: censusOperations,
    sets_applied: setsApplied, unsets_applied: unsetsApplied,
    invalid_operations: invalidOperations,
    last_irreversible_block_num: latestIrreversible,
    blocks_behind: Math.max(0, latestIrreversible - cursor)
  };
}
function parseOperation(operation) {
  if (Array.isArray(operation) && operation.length >= 2)
    return { type: normalizeOperationType(operation[0]), value: operation[1] };
  if (operation && typeof operation === "object" && typeof operation.type === "string")
    return { type: normalizeOperationType(operation.type), value: operation.value };
  return null;
}
function normalizeOperationType(type) {
  return typeof type === "string" ? (type.endsWith("_operation") ? type.slice(0, -10) : type) : "";
}
function getPostingAccount(value) {
  const auths = value?.required_posting_auths;
  return Array.isArray(auths) && auths.length === 1 && typeof auths[0] === "string" && auths[0].length ? auths[0] : null;
}
function isValidSetPayload(p) {
  if (!p || typeof p !== "object" || p.v !== PROTOCOL_VERSION || p.action !== "set") return false;
  if (typeof p.country !== "string" || !/^[A-Z]{2}$/.test(p.country)) return false;
  if (typeof p.country_name !== "string" || !p.country_name.trim()) return false;
  if (typeof p.city !== "string" || !p.city.trim()) return false;
  for (const field of ["region", "region_name"])
    if (p[field] !== undefined && p[field] !== null && typeof p[field] !== "string") return false;
  return typeof p.lat === "number" && typeof p.lon === "number" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
}
function isValidUnsetPayload(p) {
  return Boolean(p && typeof p === "object" && p.v === PROTOCOL_VERSION && p.action === "unset");
}
async function applySet(env, account, p, blockNumber, trxId) {
  await env.DB.prepare(`
    INSERT INTO census_current (account, country, country_name, region, region_name, city, lat, lon, block_num, trx_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account) DO UPDATE SET
      country = excluded.country, country_name = excluded.country_name,
      region = excluded.region, region_name = excluded.region_name,
      city = excluded.city, lat = excluded.lat, lon = excluded.lon,
      block_num = excluded.block_num, trx_id = excluded.trx_id,
      updated_at = CURRENT_TIMESTAMP
    WHERE excluded.block_num >= census_current.block_num
  `).bind(account, p.country, p.country_name, p.region ?? null, p.region_name ?? null,
    p.city, p.lat, p.lon, blockNumber, trxId).run();
}
async function applyUnset(env, account, blockNumber) {
  await env.DB.prepare(`DELETE FROM census_current WHERE account = ? AND block_num <= ?`).bind(account, blockNumber).run();
}
function getTransactionId(block, index) {
  return Array.isArray(block.transaction_ids) ? block.transaction_ids[index] || null : null;
}

// ============================================================
// PROFILE IMPORT AND RESCAN
// ============================================================
async function runScheduledProfileImporter(env) {
  const complete = await getProfileMeta(env, "import_complete", "false");
  if (complete !== "true") {
    try { await importProfileBatch(env, PROFILE_ACCOUNTS_PER_RUN); await setProfileMeta(env, "last_import_error", ""); }
    catch (error) {
      await setProfileMeta(env, "last_import_error", String(error?.message || error));
      throw error;
    }
    return;
  }
  if (await getProfileMeta(env, "rescan_state", "idle") !== "running") return;
  const token = crypto.randomUUID();
  const lease = await acquireRescanLease(env, token);
  if (!lease) { console.log("[Rescan] Another execution owns the lease"); return; }
  try {
    const result = await rescanProfileBatch(env, PROFILE_ACCOUNTS_PER_RUN, token);
    console.log("[Rescan]", JSON.stringify(result));
  } catch (error) {
    await env.DB.prepare(`
      UPDATE profile_import_meta SET value = ? WHERE key = 'rescan_last_error'
        AND EXISTS (SELECT 1 FROM profile_import_meta WHERE key = 'rescan_lease_token' AND value = ?)
    `).bind(String(error?.message || error), token).run();
    throw error;
  } finally {
    await releaseRescanLease(env, token);
  }
}
async function importProfileBatch(env, maxAccounts) {
  let lastAccount = await getProfileMeta(env, "last_account", "");
  let scanned = 0, foundLocations = 0, reachedEnd = false;
  while (scanned < maxAccounts) {
    const remaining = maxAccounts - scanned;
    const lookupLimit = Math.min(PROFILE_LOOKUP_BATCH_SIZE, remaining + (lastAccount ? 1 : 0));
    const names = await lookupHiveAccounts(lastAccount, lookupLimit);
    if (!names.length) { reachedEnd = true; break; }
    const newNames = names.filter(name => name > lastAccount);
    if (!newNames.length) { reachedEnd = true; break; }
    const batchNames = newNames.slice(0, Math.min(PROFILE_FETCH_BATCH_SIZE, remaining));
    const accounts = await getHiveAccounts(batchNames);
    if (!Array.isArray(accounts)) throw new Error("Hive get_accounts returned an invalid response");
    const accountsByName = new Map(accounts.filter(a => a && a.name).map(a => [a.name, a]));
    for (const name of batchNames) {
      const account = accountsByName.get(name);
      if (account) {
        const location = extractProfileLocation(account);
        if (location) {
          await saveProfileLocation(env, name, location, account.last_account_update || null);
          foundLocations++;
        }
      }
      scanned++;
      lastAccount = name;
      await setProfileMeta(env, "last_account", lastAccount);
    }
  }
  const actualLocations = await env.DB.prepare(`SELECT COUNT(*) AS count FROM profile_locations`).first();
  const alreadyScanned = Number(await getProfileMeta(env, "accounts_scanned", "0")) || 0;
  await setProfileMeta(env, "accounts_scanned", String(alreadyScanned + scanned));
  await setProfileMeta(env, "accounts_with_location", String(Number(actualLocations?.count || 0)));
  await setProfileMeta(env, "last_import_run", new Date().toISOString());
  if (reachedEnd) await setProfileMeta(env, "import_complete", "true");
  return { accounts_scanned_this_run: scanned, locations_found_this_run: foundLocations, last_account: lastAccount, import_complete: reachedEnd };
}

// Atomic start: initialise every rescan field and publish 'running' in one D1 batch.
// The first UPDATE acts as a conditional guard. D1 batch is transactional, but a
// conditional UPDATE that affects zero rows does not abort a batch. Therefore
// all subsequent writes are conditional on the freshly assigned job ID.
export async function startProfileRescan(env) {
  if (!env?.DB) throw new Error("D1 database is not configured");
  if (await getProfileMeta(env, "import_complete", "false") !== "true")
    return { ok: false, code: "INITIAL_IMPORT_INCOMPLETE", error: "Initial profile import is not complete" };
  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO profile_import_meta (key, value) VALUES ('rescan_state', 'idle')`).run();
  // A single guarded statement acquires ownership, but leaves the state in
  // 'initializing' until all metadata has been installed. Cron only runs 'running'.
  const lock = await env.DB.prepare(`
    UPDATE profile_import_meta SET value = ?
    WHERE key = 'rescan_state' AND value IN ('idle', 'completed')
      AND EXISTS (SELECT 1 FROM profile_import_meta WHERE key = 'import_complete' AND value = 'true')
  `).bind(`initializing:${jobId}`).run();
  if (Number(lock.meta?.changes || 0) !== 1)
    return { ok: false, code: "RESCAN_ALREADY_RUNNING", error: "A profile rescan is already running or being initialized" };
  try {
    const fields = {
      rescan_job_id: jobId, rescan_last_account: "", rescan_accounts_scanned: "0",
      rescan_locations_found: "0", rescan_locations_removed: "0",
      rescan_started_at: startedAt, rescan_completed_at: "",
      rescan_last_run: "", rescan_last_error: "",
      rescan_lease_token: "", rescan_lease_until: ""
    };
    // No cron can start during initialization. Publish state last in the same transaction.
    await env.DB.batch([
      ...Object.entries(fields).map(([key, value]) => metaStatement(env, key, value)),
      env.DB.prepare(`UPDATE profile_import_meta SET value = 'running' WHERE key = 'rescan_state' AND value = ?`).bind(`initializing:${jobId}`)
    ]);
  } catch (error) {
    // Keep 'initializing' rather than risk exposing partially reset progress.
    throw error;
  }
  return { ok: true, version: VERSION, job_id: jobId, state: "running", started_at: startedAt, accounts_per_scheduled_run: PROFILE_ACCOUNTS_PER_RUN };
}

// SQLite CURRENT_TIMESTAMP is UTC. Lease expiry is stored as Unix seconds to
// avoid timestamp-format comparison problems.
async function acquireRescanLease(env, token) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO profile_import_meta (key,value) VALUES ('rescan_lease_token','')`),
    env.DB.prepare(`INSERT OR IGNORE INTO profile_import_meta (key,value) VALUES ('rescan_lease_until','0')`),
    env.DB.prepare(`INSERT OR IGNORE INTO profile_import_meta (key,value) VALUES ('rescan_last_error','')`)
  ]);
  const result = await env.DB.prepare(`
    UPDATE profile_import_meta SET value = ?
    WHERE key = 'rescan_lease_token'
      AND EXISTS (SELECT 1 FROM profile_import_meta WHERE key = 'rescan_state' AND value = 'running')
      AND (
        value = '' OR
        COALESCE((SELECT CAST(value AS INTEGER) FROM profile_import_meta WHERE key = 'rescan_lease_until'), 0) < ?
      )
  `).bind(token, now).run();
  if (Number(result.meta?.changes || 0) !== 1) return false;
  await env.DB.prepare(`
    UPDATE profile_import_meta SET value = ?
    WHERE key = 'rescan_lease_until'
      AND EXISTS (SELECT 1 FROM profile_import_meta WHERE key = 'rescan_lease_token' AND value = ?)
  `).bind(String(now + PROFILE_LEASE_SECONDS), token).run();
  return true;
}
async function releaseRescanLease(env, token) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE profile_import_meta SET value = '0' WHERE key = 'rescan_lease_until' AND EXISTS (SELECT 1 FROM profile_import_meta WHERE key = 'rescan_lease_token' AND value = ?)` ).bind(token),
    env.DB.prepare(`UPDATE profile_import_meta SET value = '' WHERE key = 'rescan_lease_token' AND value = ?`).bind(token)
  ]);
}
async function rescanProfileBatch(env, maxAccounts, token) {
  if (await getProfileMeta(env, "rescan_state", "idle") !== "running") return { processed: 0, state: "idle" };
  const jobId = await getProfileMeta(env, "rescan_job_id", "");
  if (!jobId) throw new Error("Rescan job ID is missing");
  let lastAccount = await getProfileMeta(env, "rescan_last_account", "");
  let scanned = 0, locationsFound = 0, locationsRemoved = 0, reachedEnd = false;
  while (scanned < maxAccounts) {
    const remaining = maxAccounts - scanned;
    const names = await lookupHiveAccounts(lastAccount, Math.min(PROFILE_LOOKUP_BATCH_SIZE, remaining + (lastAccount ? 1 : 0)));
    if (!names.length) { reachedEnd = true; break; }
    const newNames = names.filter(name => name > lastAccount);
    if (!newNames.length) { reachedEnd = true; break; }
    const batchNames = newNames.slice(0, Math.min(PROFILE_FETCH_BATCH_SIZE, remaining));
    const accounts = await getHiveAccounts(batchNames);
    if (!Array.isArray(accounts)) throw new Error("Hive get_accounts returned an invalid response during rescan");
    const byName = new Map(accounts.filter(a => a && a.name).map(a => [a.name, a]));
    const missing = batchNames.filter(name => !byName.has(name));
    if (missing.length) throw new Error("Incomplete Hive get_accounts response during rescan: " + missing.slice(0, 5).join(", "));
    for (const name of batchNames) {
      const account = byName.get(name);
      const location = extractProfileLocation(account);
      const statements = [];
      if (location) {
        const normalized = normalizeLocation(location), key = makeLocationKey(normalized);
        statements.push(locationMatchInsertStatement(env, key, location));
        statements.push(profileLocationUpsertStatement(env, name, location, normalized, key, account.last_account_update || null));
      } else {
        // The DELETE and the removal counter use the same SQLite transaction.
        // changes() is evaluated in the next statement, before any other write.
        statements.push(env.DB.prepare(`DELETE FROM profile_locations WHERE account = ?`).bind(name));
        statements.push(env.DB.prepare(`
          INSERT INTO profile_import_meta (key,value) VALUES ('rescan_locations_removed', CAST(changes() AS TEXT))
          ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(profile_import_meta.value AS INTEGER) + CAST(excluded.value AS INTEGER) AS TEXT)
        `));
      }
      statements.push(metaStatement(env, "rescan_last_account", name));
      statements.push(incrementProfileMetaStatement(env, "rescan_accounts_scanned", 1));
      if (location) statements.push(incrementProfileMetaStatement(env, "rescan_locations_found", 1));
      // The lease protects against parallel batches. If the lease has expired,
      // stop before any new write instead of allowing two workers to advance.
      const leaseOwner = await getProfileMeta(env, "rescan_lease_token", "");
      const leaseUntil = Number(await getProfileMeta(env, "rescan_lease_until", "0"));
      if (leaseOwner !== token || leaseUntil < Math.floor(Date.now() / 1000))
        throw new Error("Rescan lease expired or ownership changed");
      const results = await env.DB.batch(statements);
      const removed = location ? 0 : Number(results[0]?.meta?.changes || 0);
      scanned++; lastAccount = name;
      if (location) locationsFound++;
      locationsRemoved += removed;
    }
  }
  const now = new Date().toISOString();
  if (reachedEnd) {
    await env.DB.batch([
      metaStatement(env, "rescan_state", "completed"),
      metaStatement(env, "rescan_completed_at", now),
      metaStatement(env, "rescan_last_completed_at", now),
      metaStatement(env, "rescan_last_run", now),
      metaStatement(env, "rescan_last_error", "")
    ]);
  } else {
    await env.DB.batch([
      metaStatement(env, "rescan_last_run", now),
      metaStatement(env, "rescan_last_error", "")
    ]);
  }
  return { job_id: jobId, processed: scanned, locations_found: locationsFound, locations_removed: locationsRemoved, last_account: lastAccount, state: reachedEnd ? "completed" : "running" };
}
function incrementProfileMetaStatement(env, key, amount) {
  return env.DB.prepare(`
    INSERT INTO profile_import_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(profile_import_meta.value AS INTEGER) + ? AS TEXT)
  `).bind(key, String(amount), amount);
}
export async function getProfileRescanStatus(env) {
  const result = await env.DB.prepare(`SELECT key,value FROM profile_import_meta WHERE key LIKE 'rescan_%'`).all();
  const meta = Object.fromEntries(result.results.map(row => [row.key, row.value]));
  const complete = await getProfileMeta(env, "import_complete", "false");
  return {
    ok: true, version: VERSION, available: complete === "true",
    state: meta.rescan_state || "idle", job_id: meta.rescan_job_id || "",
    started_at: meta.rescan_started_at || "", completed_at: meta.rescan_completed_at || "",
    last_completed_full_scan: meta.rescan_last_completed_at || "",
    last_account: meta.rescan_last_account || "",
    accounts_scanned: Number(meta.rescan_accounts_scanned || 0),
    locations_found: Number(meta.rescan_locations_found || 0),
    locations_removed: Number(meta.rescan_locations_removed || 0),
    last_run: meta.rescan_last_run || "", last_error: meta.rescan_last_error || "",
    accounts_per_scheduled_run: PROFILE_ACCOUNTS_PER_RUN
  };
}

// ============================================================
// HIVE PROFILE HELPERS
// ============================================================
async function lookupHiveAccounts(lowerBound, limit) {
  const result = await hiveRpc("condenser_api.lookup_accounts", [lowerBound, limit]);
  if (!Array.isArray(result)) throw new Error("Invalid lookup_accounts response");
  return result.filter(name => typeof name === "string");
}
async function getHiveAccounts(names) {
  return names.length ? hiveRpc("condenser_api.get_accounts", [names]) : [];
}
function extractProfileLocation(account) {
  const posting = parseAccountMetadata(account.posting_json_metadata);
  const regular = parseAccountMetadata(account.json_metadata);
  for (const value of [posting?.profile?.location, regular?.profile?.location]) {
    if (typeof value !== "string") continue;
    const location = value.trim();
    if (location) return location.slice(0, 500);
  }
  return null;
}
function parseAccountMetadata(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}
function normalizeLocation(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
function makeLocationKey(value) {
  return normalizeLocation(value).toLocaleLowerCase("en-US");
}
function locationMatchInsertStatement(env, key, rawLocation) {
  return env.DB.prepare(`
    INSERT OR IGNORE INTO location_matches (location_key,original_example,status,source)
    VALUES (?,?,'pending','hive_profile')
  `).bind(key, rawLocation);
}
function profileLocationUpsertStatement(env, account, rawLocation, normalized, key, lastAccountUpdate) {
  return env.DB.prepare(`
    INSERT INTO profile_locations (
      account,raw_location,normalized_location,location_key,
      match_id,match_status,last_account_update,fetched_at
    )
    SELECT ?,?,?,?,m.id,
      COALESCE((SELECT o.status FROM profile_location_overrides o
                WHERE o.account = ? AND o.match_id = m.id),m.status),
      ?,CURRENT_TIMESTAMP
    FROM location_matches m WHERE m.location_key = ?
    ON CONFLICT(account) DO UPDATE SET
      raw_location = excluded.raw_location,
      normalized_location = excluded.normalized_location,
      location_key = excluded.location_key,
      match_id = excluded.match_id,
      match_status = excluded.match_status,
      last_account_update = excluded.last_account_update,
      fetched_at = CURRENT_TIMESTAMP
  `).bind(account, rawLocation, normalized, key, account, lastAccountUpdate, key);
}
async function saveProfileLocation(env, account, rawLocation, lastAccountUpdate) {
  const normalized = normalizeLocation(rawLocation), key = makeLocationKey(normalized);
  if (!key) return;
  await env.DB.batch([
    locationMatchInsertStatement(env, key, rawLocation),
    profileLocationUpsertStatement(env, account, rawLocation, normalized, key, lastAccountUpdate)
  ]);
}

// ============================================================
// LOCAL CLASSIFIER
// ============================================================
async function runScheduledLocationClassifier(env) {
  try {
    await setProfileMeta(env, "last_classifier_started", new Date().toISOString());
    const result = await classifyPendingLocations(env, LOCATION_CLASSIFY_PER_RUN);
    await env.DB.batch([
      metaStatement(env, "last_classifier_run", new Date().toISOString()),
      metaStatement(env, "last_classifier_processed", String(result.processed)),
      metaStatement(env, "last_classifier_matched", String(result.matched)),
      metaStatement(env, "last_classifier_ambiguous", String(result.ambiguous)),
      metaStatement(env, "last_classifier_rejected", String(result.rejected)),
      metaStatement(env, "last_classifier_error", "")
    ]);
    return result;
  } catch (error) {
    console.error("[Classifier] Execution failed:", error);
    try { await setProfileMeta(env, "last_classifier_error", String(error?.message || error)); }
    catch (e) { console.error("[Classifier] Cannot save error:", e); }
    throw error;
  }
}
async function classifyPendingLocations(env, limit) {
  const pending = await env.DB.prepare(`
    SELECT id,original_example FROM location_matches
    WHERE status = 'pending' AND COALESCE(source,'') != 'admin_manual'
    ORDER BY id LIMIT ?
  `).bind(limit).all();
  let matched = 0, ambiguous = 0, rejected = 0;
  for (const row of pending.results) {
    const c = classifyLocation(row.original_example);
    if (!["matched", "ambiguous", "rejected"].includes(c.status))
      throw new Error(`Invalid classification for location ID ${row.id}`);
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE location_matches SET status = ?, location_type = COALESCE(?,location_type),
          country = ?, country_name = ?, region = ?, region_name = ?, city = ?,
          lat = ?, lon = ?, confidence = ?, source = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending' AND COALESCE(source,'') != 'admin_manual'
      `).bind(c.status,c.location_type,c.country,c.country_name,c.region,c.region_name,
        c.city,c.lat,c.lon,c.confidence,c.source,row.id),
      profileStatusSyncStatement(env,row.id)
    ]);
    if (Number(results[0]?.meta?.changes || 0) === 0) continue;
    if (c.status === "matched") matched++;
    else if (c.status === "ambiguous") ambiguous++;
    else rejected++;
  }
  return { processed: matched + ambiguous + rejected, matched, ambiguous, rejected };
}

// ============================================================
// GEONAMES GEOCODER
// ============================================================
async function runScheduledGeocoder(env) {
  try {
    await setProfileMeta(env, "last_geocoder_started", new Date().toISOString());
    if (!env.GEONAMES_USERNAME) throw new Error("GEONAMES_USERNAME is not configured");
    const result = await geocodeAmbiguousLocations(env, GEOCODE_PER_RUN);
    await env.DB.batch([
      metaStatement(env, "last_geocoder_run", new Date().toISOString()),
      metaStatement(env, "last_geocoder_processed", String(result.processed)),
      metaStatement(env, "last_geocoder_matched", String(result.matched)),
      metaStatement(env, "last_geocoder_ambiguous", String(result.ambiguous)),
      metaStatement(env, "last_geocoder_rejected", String(result.rejected)),
      metaStatement(env, "last_geocoder_errors", String(result.errors)),
      metaStatement(env, "last_geocoder_error", "")
    ]);
    return result;
  } catch (error) {
    console.error("[Geocoder] Execution failed:", error);
    try { await setProfileMeta(env, "last_geocoder_error", String(error?.message || error)); }
    catch (e) { console.error("[Geocoder] Cannot save error:", e); }
    throw error;
  }
}
async function geocodeAmbiguousLocations(env, limit) {
  const retryBefore = new Date(Date.now() - GEOCODE_ERROR_RETRY_HOURS * 3600000).toISOString();
  const candidates = await env.DB.prepare(`
    SELECT m.id,m.location_key,m.original_example
    FROM location_matches m LEFT JOIN location_geocode_attempts a ON a.location_key = m.location_key
    WHERE m.status = 'ambiguous' AND COALESCE(m.source,'') != 'admin_manual'
      AND (a.location_key IS NULL OR (a.outcome = 'error' AND a.attempted_at < ?))
    ORDER BY m.id LIMIT ?
  `).bind(retryBefore,limit).all();
  let matched = 0, ambiguous = 0, rejected = 0, errors = 0;
  for (const row of candidates.results) {
    try {
      const result = await geocodeLocation(row.original_example, env.GEONAMES_USERNAME);
      const safe = isSafeGeocoderMatch(row.original_example, result);
      console.log("[Geocoder] Result", JSON.stringify({
        location: row.original_example, geocoder_status: result.status,
        geocoder_reason: result.reason || null, final_status: safe.status,
        final_reason: safe.reason || null, location_type: safe.location_type || null,
        country: safe.country || null, city: safe.city || null
      }));
      if (safe.status === "matched") {
        const results = await env.DB.batch([
          env.DB.prepare(`
            UPDATE location_matches SET status = 'matched',
              location_type = COALESCE(?,location_type), country = ?, country_name = ?,
              region = ?, region_name = ?, city = ?, lat = ?, lon = ?,
              confidence = ?, source = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'ambiguous' AND COALESCE(source,'') != 'admin_manual'
          `).bind(safe.location_type,safe.country,safe.country_name,safe.region,
            safe.region_name,safe.city,safe.lat,safe.lon,safe.confidence,safe.source,row.id),
          profileStatusSyncStatement(env,row.id)
        ]);
        if (Number(results[0]?.meta?.changes || 0) > 0) matched++;
      } else if (safe.status === "rejected") {
        const results = await env.DB.batch([
          env.DB.prepare(`
            UPDATE location_matches SET status = 'rejected', source = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'ambiguous' AND COALESCE(source,'') != 'admin_manual'
          `).bind(safe.source || "geonames_v4",row.id),
          profileStatusSyncStatement(env,row.id)
        ]);
        if (Number(results[0]?.meta?.changes || 0) > 0) rejected++;
      } else ambiguous++;
      await recordGeocodeAttempt(env,row.location_key,safe.status,null);
    } catch (error) {
      errors++;
      await recordGeocodeAttempt(env,row.location_key,"error",String(error?.message || error));
      console.error(`[Geocoder] Failed ${row.location_key}:`,error);
      break;
    }
  }
  return { processed: matched + ambiguous + rejected + errors, matched, ambiguous, rejected, errors };
}
function isSafeGeocoderMatch(rawLocation, result) {
  if (result.status !== "matched") return result;
  const ambiguousResult = { ...result, status: "ambiguous", reason: "requires_manual_review" };
  if (!["locality","country_proxy","region_proxy"].includes(result.location_type)) return ambiguousResult;
  if (!result.country || !Number.isFinite(Number(result.lat)) ||
      !Number.isFinite(Number(result.lon)) || result.confidence !== 1) return ambiguousResult;
  if (result.location_type === "country_proxy")
    return result.reason === "country_capital_proxy" ? result : ambiguousResult;
  if (result.location_type === "region_proxy") {
    const verified = result.reason === "region_capital_proxy" &&
      typeof result.region_name === "string" && result.region_name.trim().length > 0 &&
      typeof result.city === "string" && result.city.trim().length > 0;
    return verified ? result : ambiguousResult;
  }
  if (!result.city) return ambiguousResult;
  const normalize = value => String(value || "").normalize("NFKD")
    .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().replace(/\s+/g, " ");
  const original = normalize(rawLocation), city = normalize(result.city);
  return original === city || original.startsWith(city + " ") ? result : ambiguousResult;
}
async function recordGeocodeAttempt(env,locationKey,outcome,errorMessage) {
  await env.DB.prepare(`
    INSERT INTO location_geocode_attempts (location_key,provider,attempted_at,outcome,error_message)
    VALUES (?,'geonames',CURRENT_TIMESTAMP,?,?)
    ON CONFLICT(location_key) DO UPDATE SET
      provider = excluded.provider, attempted_at = excluded.attempted_at,
      outcome = excluded.outcome, error_message = excluded.error_message
  `).bind(locationKey,outcome,errorMessage).run();
}
function profileStatusSyncStatement(env,matchId) {
  return env.DB.prepare(`
    UPDATE profile_locations SET match_status = (
      SELECT m.status FROM location_matches m WHERE m.id = profile_locations.match_id
    )
    WHERE match_id = ?
      AND EXISTS (SELECT 1 FROM location_matches m WHERE m.id = profile_locations.match_id)
      AND NOT EXISTS (SELECT 1 FROM profile_location_overrides o
                      WHERE o.account = profile_locations.account AND o.match_id = profile_locations.match_id)
      AND match_status IS NOT (
        SELECT m.status FROM location_matches m WHERE m.id = profile_locations.match_id
      )
  `).bind(matchId);
}

// ============================================================
// STATUS ENDPOINTS
// ============================================================
async function getProfileImportStatus(env) {
  const rows = await env.DB.prepare(`SELECT key,value FROM profile_import_meta`).all();
  const meta = Object.fromEntries(rows.results.map(row => [row.key,row.value]));
  const counts = await env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM profile_locations) AS stored_profile_locations,
           (SELECT COUNT(*) FROM location_matches) AS unique_location_strings,
           (SELECT COUNT(*) FROM location_matches WHERE status = 'pending') AS pending_location_matches
  `).first();
  return {
    ok: true, version: VERSION, import_complete: meta.import_complete === "true",
    last_account: meta.last_account || "", accounts_scanned: Number(meta.accounts_scanned || 0),
    accounts_with_location: Number(counts?.stored_profile_locations || 0),
    stored_profile_locations: Number(counts?.stored_profile_locations || 0),
    unique_location_strings: Number(counts?.unique_location_strings || 0),
    pending_location_matches: Number(counts?.pending_location_matches || 0),
    last_import_run: meta.last_import_run || "", last_import_error: meta.last_import_error || "",
    accounts_per_scheduled_run: PROFILE_ACCOUNTS_PER_RUN,
    rescan_state: meta.rescan_state || "idle",
    last_completed_full_scan: meta.rescan_last_completed_at || ""
  };
}
async function getClassifierStatus(env) {
  const counts = await env.DB.prepare(`
    SELECT status,location_type,COUNT(*) AS count FROM location_matches
    GROUP BY status,location_type ORDER BY status,location_type
  `).all();
  const meta = await getMetaByPrefix(env,"last_classifier_%");
  return {
    ok: true, version: VERSION, classifier_version: getClassifierVersion(),
    last_classifier_started: meta.last_classifier_started || "",
    last_classifier_run: meta.last_classifier_run || "",
    last_classifier_error: meta.last_classifier_error || "",
    last_classifier_processed: Number(meta.last_classifier_processed || 0),
    last_classifier_matched: Number(meta.last_classifier_matched || 0),
    last_classifier_ambiguous: Number(meta.last_classifier_ambiguous || 0),
    last_classifier_rejected: Number(meta.last_classifier_rejected || 0),
    locations_per_scheduled_run: LOCATION_CLASSIFY_PER_RUN, counts: counts.results
  };
}
async function getGeocoderStatus(env) {
  const meta = await getMetaByPrefix(env,"last_geocoder_%");
  const attempts = await env.DB.prepare(`
    SELECT outcome,COUNT(*) AS count FROM location_geocode_attempts GROUP BY outcome ORDER BY outcome
  `).all();
  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM location_matches m
    LEFT JOIN location_geocode_attempts a ON a.location_key = m.location_key
    WHERE m.status = 'ambiguous' AND COALESCE(m.source,'') != 'admin_manual'
      AND a.location_key IS NULL
  `).first();
  return {
    ok: true, version: VERSION, geocoder_version: getGeocoderVersion(),
    configured: Boolean(env.GEONAMES_USERNAME),
    last_geocoder_started: meta.last_geocoder_started || "",
    last_geocoder_run: meta.last_geocoder_run || "",
    last_geocoder_error: meta.last_geocoder_error || "",
    last_geocoder_processed: Number(meta.last_geocoder_processed || 0),
    last_geocoder_matched: Number(meta.last_geocoder_matched || 0),
    last_geocoder_ambiguous: Number(meta.last_geocoder_ambiguous || 0),
    last_geocoder_rejected: Number(meta.last_geocoder_rejected || 0),
    last_geocoder_errors: Number(meta.last_geocoder_errors || 0),
    requests_per_scheduled_run: GEOCODE_PER_RUN,
    error_retry_hours: GEOCODE_ERROR_RETRY_HOURS,
    remaining_untried_ambiguous: Number(remaining?.count || 0),
    attempts: attempts.results
  };
}
async function getMetaByPrefix(env,pattern) {
  const result = await env.DB.prepare(`SELECT key,value FROM profile_import_meta WHERE key LIKE ?`).bind(pattern).all();
  return Object.fromEntries(result.results.map(row => [row.key,row.value]));
}

// ============================================================
// HIVE RPC AND METADATA
// ============================================================
async function hiveRpc(method,params) {
  const response = await fetch(HIVE_RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Hive RPC HTTP ${response.status}: ${method}`);
  const data = await response.json();
  if (data.error) throw new Error(`Hive RPC ${method}: ${JSON.stringify(data.error)}`);
  if (data.result === undefined || data.result === null) throw new Error(`Hive RPC returned no result: ${method}`);
  return data.result;
}
async function getDynamicGlobalProperties() {
  return hiveRpc("condenser_api.get_dynamic_global_properties",[]);
}
async function getBlockRange(startBlock,count) {
  const result = await hiveRpc("block_api.get_block_range",{ starting_block_num: startBlock, count });
  return result.blocks;
}
async function getMeta(env,key) {
  const row = await env.DB.prepare(`SELECT value FROM census_meta WHERE key = ?`).bind(key).first();
  return row?.value ?? "";
}
async function getMetaNumber(env,key,fallback) {
  const value = await getMeta(env,key);
  if (value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function censusMetaStatement(env,key,value) {
  return env.DB.prepare(`
    INSERT INTO census_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key,String(value));
}
async function setMeta(env,key,value) { await censusMetaStatement(env,key,value).run(); }
async function getProfileMeta(env,key,fallback = "") {
  const row = await env.DB.prepare(`SELECT value FROM profile_import_meta WHERE key = ?`).bind(key).first();
  return row?.value ?? fallback;
}
function metaStatement(env,key,value) {
  return env.DB.prepare(`
    INSERT INTO profile_import_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key,String(value));
}
async function setProfileMeta(env,key,value) { await metaStatement(env,key,value).run(); }
async function countCensusAccounts(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM census_current`).first();
  return Number(row?.count || 0);
}
async function recordIndexerError(env,error) {
  await setMeta(env,"last_error",String(error?.message || error));
  await setMeta(env,"last_error_at",new Date().toISOString());
}
async function clearIndexerError(env) {
  await setMeta(env,"last_error","");
  await setMeta(env,"last_error_at","");
}
function jsonResponse(data,status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
function errorResponse(error) {
  console.error(error);
  return jsonResponse({ ok: false, version: VERSION, error: String(error?.message || error) },500);
}
