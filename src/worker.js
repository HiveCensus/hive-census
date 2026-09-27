const HIVE_RPC = "https://api.hive.blog";
const CENSUS_ID = "hive_census";
const PROTOCOL_VERSION = 1;

// Ile bloków skanujemy przy jednym ręcznym wywołaniu.
// Hive produkuje blok mniej więcej co 3 sekundy.
const DEFAULT_SCAN_BLOCKS = 2000;
const MAX_SCAN_BLOCKS = 5000;
const BLOCK_BATCH_SIZE = 100;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------------------------------------------------------
    // STATUS
    // ---------------------------------------------------------

    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        service: "Hive Census",
        version: "0.6.1",
        database: Boolean(env.DB),
        assets: Boolean(env.ASSETS)
      });
    }

    // ---------------------------------------------------------
    // CURRENT CENSUS
    // ---------------------------------------------------------

    if (url.pathname === "/api/census" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(`
          SELECT
            account,
            country,
            country_name,
            region,
            region_name,
            city,
            lat,
            lon,
            block_num,
            trx_id,
            updated_at
          FROM census_current
          ORDER BY country_name, region_name, city, account
        `).all();

        return json({
          ok: true,
          count: result.results.length,
          census: result.results
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    // ---------------------------------------------------------
    // INDEXER STATUS
    // ---------------------------------------------------------

    if (url.pathname === "/api/indexer/status") {
      try {
        const lastScanned = await getMeta(env.DB, "last_scanned_block");

        const countResult = await env.DB.prepare(`
          SELECT COUNT(*) AS count
          FROM census_current
        `).first();

        const props = await hiveRpc(
          "condenser_api.get_dynamic_global_properties",
          []
        );

        return json({
          ok: true,
          last_scanned_block:
            lastScanned === null ? null : Number(lastScanned),
          head_block_number: Number(props.head_block_number),
          census_accounts: Number(countResult?.count || 0)
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    // ---------------------------------------------------------
    // MANUAL SCAN
    //
    // Examples:
    //
    // /api/indexer/scan
    //
    // /api/indexer/scan?blocks=5000
    //
    // First run:
    // scans backwards from current head.
    //
    // Later runs:
    // continues from last_scanned_block + 1.
    // ---------------------------------------------------------

    if (url.pathname === "/api/indexer/scan") {
      try {
        let requestedBlocks = Number(
          url.searchParams.get("blocks") || DEFAULT_SCAN_BLOCKS
        );

        if (
          !Number.isInteger(requestedBlocks) ||
          requestedBlocks < 1
        ) {
          requestedBlocks = DEFAULT_SCAN_BLOCKS;
        }

        requestedBlocks = Math.min(
          requestedBlocks,
          MAX_SCAN_BLOCKS
        );

        const props = await hiveRpc(
          "condenser_api.get_dynamic_global_properties",
          []
        );

        const headBlock = Number(props.head_block_number);

        if (!Number.isInteger(headBlock) || headBlock <= 0) {
          throw new Error("Hive RPC returned invalid head block.");
        }

        const storedLastBlock = await getMeta(
          env.DB,
          "last_scanned_block"
        );

        let startBlock;

        if (storedLastBlock !== null) {
          startBlock = Number(storedLastBlock) + 1;

          if (startBlock > headBlock) {
            return json({
              ok: true,
              message: "Indexer is already caught up.",
              head_block_number: headBlock,
              last_scanned_block: Number(storedLastBlock),
              blocks_scanned: 0,
              census_operations: 0,
              set_operations: 0,
              unset_operations: 0
            });
          }
        } else {
          startBlock = Math.max(
            1,
            headBlock - requestedBlocks + 1
          );
        }

        const endBlock = Math.min(
          headBlock,
          startBlock + requestedBlocks - 1
        );

        const stats = {
          blocks_scanned: 0,
          transactions_scanned: 0,
          operations_scanned: 0,
          census_operations: 0,
          valid_census_operations: 0,
          invalid_census_operations: 0,
          set_operations: 0,
          unset_operations: 0
        };

        for (
          let batchStart = startBlock;
          batchStart <= endBlock;
          batchStart += BLOCK_BATCH_SIZE
        ) {
          const count = Math.min(
            BLOCK_BATCH_SIZE,
            endBlock - batchStart + 1
          );

          const response = await hiveRpc(
            "block_api.get_block_range",
            {
              starting_block_num: batchStart,
              count
            }
          );

          const blocks = Array.isArray(response?.blocks)
            ? response.blocks
            : [];

          if (blocks.length === 0) {
            throw new Error(
              `Hive RPC returned no blocks starting at ${batchStart}.`
            );
          }

          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const blockNum = batchStart + i;

            await processBlock(
              env.DB,
              block,
              blockNum,
              stats
            );

            stats.blocks_scanned++;
          }

          const actualLastBlock =
            batchStart + blocks.length - 1;

          await setMeta(
            env.DB,
            "last_scanned_block",
            String(actualLastBlock)
          );
        }

        const countResult = await env.DB.prepare(`
          SELECT COUNT(*) AS count
          FROM census_current
        `).first();

        return json({
          ok: true,
          start_block: startBlock,
          end_block: endBlock,
          head_block_number: headBlock,
          ...stats,
          active_census_accounts: Number(
            countResult?.count || 0
          )
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    // ---------------------------------------------------------
    // STATIC WEBSITE
    // ---------------------------------------------------------

    return env.ASSETS.fetch(request);
  }
};

// ============================================================
// BLOCK PROCESSING
// ============================================================

async function processBlock(db, block, blockNum, stats) {
  const transactions = Array.isArray(block?.transactions)
    ? block.transactions
    : [];

  const transactionIds = Array.isArray(block?.transaction_ids)
    ? block.transaction_ids
    : [];

  for (
    let txIndex = 0;
    txIndex < transactions.length;
    txIndex++
  ) {
    const tx = transactions[txIndex];

    stats.transactions_scanned++;

    const operations = Array.isArray(tx?.operations)
      ? tx.operations
      : [];

    const trxId =
      transactionIds[txIndex] || null;

    for (
      let opIndex = 0;
      opIndex < operations.length;
      opIndex++
    ) {
      const operation = operations[opIndex];

      stats.operations_scanned++;

      const parsed = parseCustomJsonOperation(operation);

      if (!parsed) {
        continue;
      }

      if (parsed.id !== CENSUS_ID) {
        continue;
      }

      stats.census_operations++;

      const account = getPostingAccount(parsed);

      if (!account) {
        stats.invalid_census_operations++;
        continue;
      }

      let payload;

      try {
        payload =
          typeof parsed.json === "string"
            ? JSON.parse(parsed.json)
            : parsed.json;
      } catch {
        stats.invalid_census_operations++;
        continue;
      }

      if (!payload || payload.v !== PROTOCOL_VERSION) {
        stats.invalid_census_operations++;
        continue;
      }

      if (payload.action === "set") {
        if (!isValidSetPayload(payload)) {
          stats.invalid_census_operations++;
          continue;
        }

        await applySet(
          db,
          account,
          payload,
          blockNum,
          trxId
        );

        stats.valid_census_operations++;
        stats.set_operations++;

        continue;
      }

      if (payload.action === "unset") {
        await applyUnset(
          db,
          account,
          blockNum
        );

        stats.valid_census_operations++;
        stats.unset_operations++;

        continue;
      }

      stats.invalid_census_operations++;
    }
  }
}

// ============================================================
// HIVE OPERATION PARSING
// ============================================================

function parseCustomJsonOperation(operation) {
  if (!Array.isArray(operation) || operation.length !== 2) {
    return null;
  }

  const [type, value] = operation;

  if (type !== "custom_json") {
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  return value;
}

function getPostingAccount(operation) {
  const posting = operation.required_posting_auths;

  if (!Array.isArray(posting)) {
    return null;
  }

  // Hive Census v1 expects exactly one posting signer.
  if (posting.length !== 1) {
    return null;
  }

  const account = posting[0];

  if (
    typeof account !== "string" ||
    account.length === 0
  ) {
    return null;
  }

  return account;
}

// ============================================================
// PROTOCOL v1 VALIDATION
// ============================================================

function isValidSetPayload(payload) {
  if (payload.v !== 1) {
    return false;
  }

  if (payload.action !== "set") {
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
    payload.country_name.trim() === ""
  ) {
    return false;
  }

  if (
    payload.region !== null &&
    payload.region !== undefined &&
    typeof payload.region !== "string"
  ) {
    return false;
  }

  if (
    payload.region_name !== null &&
    payload.region_name !== undefined &&
    typeof payload.region_name !== "string"
  ) {
    return false;
  }

  if (
    typeof payload.city !== "string" ||
    payload.city.trim() === ""
  ) {
    return false;
  }

  if (
    typeof payload.lat !== "number" ||
    !Number.isFinite(payload.lat) ||
    payload.lat < -90 ||
    payload.lat > 90
  ) {
    return false;
  }

  if (
    typeof payload.lon !== "number" ||
    !Number.isFinite(payload.lon) ||
    payload.lon < -180 ||
    payload.lon > 180
  ) {
    return false;
  }

  return true;
}

// ============================================================
// DATABASE
// ============================================================

async function applySet(
  db,
  account,
  payload,
  blockNum,
  trxId
) {
  await db.prepare(`
    INSERT INTO census_current (
      account,
      country,
      country_name,
      region,
      region_name,
      city,
      lat,
      lon,
      block_num,
      trx_id,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

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

    WHERE excluded.block_num >= census_current.block_num
  `)
    .bind(
      account,
      payload.country,
      payload.country_name,
      payload.region ?? null,
      payload.region_name ?? null,
      payload.city,
      payload.lat,
      payload.lon,
      blockNum,
      trxId
    )
    .run();
}

async function applyUnset(
  db,
  account,
  blockNum
) {
  await db.prepare(`
    DELETE FROM census_current
    WHERE account = ?
      AND block_num <= ?
  `)
    .bind(account, blockNum)
    .run();
}

async function getMeta(db, key) {
  const row = await db.prepare(`
    SELECT value
    FROM census_meta
    WHERE key = ?
  `)
    .bind(key)
    .first();

  return row ? row.value : null;
}

async function setMeta(db, key, value) {
  await db.prepare(`
    INSERT INTO census_meta (key, value)
    VALUES (?, ?)

    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value
  `)
    .bind(key, value)
    .run();
}

// ============================================================
// HIVE RPC
// ============================================================

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
    })
  });

  if (!response.ok) {
    throw new Error(
      `Hive RPC HTTP error ${response.status}.`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Hive RPC error: ${JSON.stringify(data.error)}`
    );
  }

  if (data.result === undefined) {
    throw new Error(
      `Hive RPC returned no result for ${method}.`
    );
  }

  return data.result;
}

// ============================================================
// HTTP HELPERS
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function errorResponse(error) {
  console.error(error);

  return json(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    },
    500
  );
}
