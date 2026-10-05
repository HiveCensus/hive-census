const HIVE_RPC = "https://api.hive.blog";
const CENSUS_ID = "hive_census";
const PROTOCOL_VERSION = 1;

const VERSION = "0.7.0";

// ============================================================
// MANUAL INDEXER
// ============================================================

const DEFAULT_MANUAL_SCAN_BLOCKS = 500;
const MAX_MANUAL_SCAN_BLOCKS = 1000;

// ============================================================
// SCHEDULED INDEXER / CATCH-UP
// ============================================================
//
// Hive produkuje około 100 bloków na 5 minut.
//
// Nie skanujemy już sztywnej liczby bloków.
// Liczba bloków zależy od wielkości zaległości.
//
// Normalny stan:
//   <= 250 bloków zaległości
//
// Catch-up:
//   251–2000
//
// Aggressive catch-up:
//   > 2000
//
// Limit jest celowo ograniczony, żeby pojedyncze uruchomienie
// Workera nie próbowało przetworzyć tysięcy bloków naraz.
//

const NORMAL_SCAN_BLOCKS = 250;
const CATCHUP_SCAN_BLOCKS = 600;
const AGGRESSIVE_SCAN_BLOCKS = 1000;

// ============================================================
// RPC BATCH SIZE
// ============================================================
//
// Jedno wywołanie block_api.get_block_range pobiera
// maksymalnie 100 bloków.
//

const BLOCK_BATCH_SIZE = 100;


// ============================================================
// WORKER
// ============================================================

export default {

  // ==========================================================
  // HTTP
  // ==========================================================

  async fetch(request, env) {
    const url = new URL(request.url);

    // --------------------------------------------------------
    // WORKER STATUS
    // --------------------------------------------------------

    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        service: "Hive Census",
        version: VERSION,
        database: Boolean(env.DB),
        assets: Boolean(env.ASSETS)
      });
    }

    // --------------------------------------------------------
    // CURRENT CENSUS
    // --------------------------------------------------------

    if (
      url.pathname === "/api/census" &&
      request.method === "GET"
    ) {
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
          ORDER BY
            country_name,
            region_name,
            city,
            account
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

    // --------------------------------------------------------
    // INDEXER STATUS
    // --------------------------------------------------------

    if (url.pathname === "/api/indexer/status") {
      try {
        const [
          lastScanned,
          lastScheduledRun,
          lastSuccessfulScan,
          lastError,
          lastErrorAt
        ] = await Promise.all([
          getMeta(
            env.DB,
            "last_scanned_block"
          ),

          getMeta(
            env.DB,
            "last_scheduled_run"
          ),

          getMeta(
            env.DB,
            "last_successful_scan"
          ),

          getMeta(
            env.DB,
            "last_error"
          ),

          getMeta(
            env.DB,
            "last_error_at"
          )
        ]);

        const countResult =
          await env.DB.prepare(`
            SELECT COUNT(*) AS count
            FROM census_current
          `).first();

        const props = await hiveRpc(
          "condenser_api.get_dynamic_global_properties",
          []
        );

        const headBlock =
          Number(
            props.head_block_number
          );

        const irreversibleBlock =
          Number(
            props.last_irreversible_block_num
          );

        const lastScannedNumber =
          lastScanned === null
            ? null
            : Number(lastScanned);

        const blocksBehind =
          lastScannedNumber === null
            ? null
            : Math.max(
                0,
                irreversibleBlock -
                lastScannedNumber
              );

        const indexerState =
          determineIndexerState(
            blocksBehind,
            lastScheduledRun,
            lastErrorAt
          );

        return json({
          ok: true,

          version:
            VERSION,

          indexer_state:
            indexerState,

          last_scanned_block:
            lastScannedNumber,

          head_block_number:
            headBlock,

          last_irreversible_block_num:
            irreversibleBlock,

          blocks_behind:
            blocksBehind,

          census_accounts:
            Number(
              countResult?.count || 0
            ),

          last_scheduled_run:
            lastScheduledRun,

          last_successful_scan:
            lastSuccessfulScan,

          last_error:
            lastError,

          last_error_at:
            lastErrorAt
        });

      } catch (error) {
        return errorResponse(error);
      }
    }

    // --------------------------------------------------------
    // MANUAL INDEXER
    //
    // /api/indexer/scan
    // /api/indexer/scan?blocks=500
    // --------------------------------------------------------

    if (url.pathname === "/api/indexer/scan") {
      try {
        let requestedBlocks =
          Number(
            url.searchParams.get("blocks") ||
            DEFAULT_MANUAL_SCAN_BLOCKS
          );

        if (
          !Number.isInteger(
            requestedBlocks
          ) ||
          requestedBlocks < 1
        ) {
          requestedBlocks =
            DEFAULT_MANUAL_SCAN_BLOCKS;
        }

        requestedBlocks =
          Math.min(
            requestedBlocks,
            MAX_MANUAL_SCAN_BLOCKS
          );

        const result =
          await scanHive(
            env,
            requestedBlocks
          );

        await setMeta(
          env.DB,
          "last_successful_scan",
          new Date().toISOString()
        );

        await clearIndexerError(
          env.DB
        );

        return json({
          ok: true,
          mode: "manual",
          ...result
        });

      } catch (error) {
        await recordIndexerError(
          env.DB,
          error
        );

        return errorResponse(error);
      }
    }

    // --------------------------------------------------------
    // STATIC WEBSITE
    // --------------------------------------------------------

    return env.ASSETS.fetch(
      request
    );
  },


  // ==========================================================
  // CLOUDFLARE CRON
  // ==========================================================

  async scheduled(
    controller,
    env,
    ctx
  ) {
    ctx.waitUntil(
      runScheduledIndexer(
        env
      )
    );
  }
};


// ============================================================
// SCHEDULED INDEXER
// ============================================================

async function runScheduledIndexer(
  env
) {
  const startedAt =
    new Date().toISOString();

  /*
   * Zapisujemy moment rozpoczęcia Crona PRZED skanowaniem.
   *
   * Dzięki temu last_scheduled_run odpowiada na pytanie:
   * "Czy Cloudflare w ogóle uruchamia Cron?"
   *
   * W poprzedniej wersji pole było aktualizowane dopiero
   * po udanym zakończeniu skanu.
   */

  await setMeta(
    env.DB,
    "last_scheduled_run",
    startedAt
  );

  try {
    // --------------------------------------------------------
    // CHECK CURRENT LAG
    // --------------------------------------------------------

    const props =
      await hiveRpc(
        "condenser_api.get_dynamic_global_properties",
        []
      );

    const irreversibleBlock =
      Number(
        props.last_irreversible_block_num
      );

    if (
      !Number.isInteger(
        irreversibleBlock
      ) ||
      irreversibleBlock <= 0
    ) {
      throw new Error(
        "Hive RPC returned invalid last irreversible block."
      );
    }

    const storedLastBlock =
      await getMeta(
        env.DB,
        "last_scanned_block"
      );

    const lastScanned =
      storedLastBlock === null
        ? null
        : Number(
            storedLastBlock
          );

    const blocksBehind =
      lastScanned === null
        ? NORMAL_SCAN_BLOCKS
        : Math.max(
            0,
            irreversibleBlock -
            lastScanned
          );

    // --------------------------------------------------------
    // SELECT SCAN SIZE
    // --------------------------------------------------------

    const requestedBlocks =
      chooseScheduledScanSize(
        blocksBehind
      );

    console.log(
      "Hive Census scheduled indexer starting:",
      JSON.stringify({
        started_at:
          startedAt,

        last_scanned_block:
          lastScanned,

        last_irreversible_block_num:
          irreversibleBlock,

        blocks_behind:
          blocksBehind,

        requested_blocks:
          requestedBlocks
      })
    );

    // --------------------------------------------------------
    // SCAN
    // --------------------------------------------------------

    const result =
      await scanHive(
        env,
        requestedBlocks
      );

    const completedAt =
      new Date().toISOString();

    await setMeta(
      env.DB,
      "last_successful_scan",
      completedAt
    );

    await clearIndexerError(
      env.DB
    );

    console.log(
      "Hive Census scheduled scan completed:",
      JSON.stringify({
        completed_at:
          completedAt,
        ...result
      })
    );

  } catch (error) {
    await recordIndexerError(
      env.DB,
      error
    );

    console.error(
      "Hive Census scheduled scan failed:",
      error
    );

    throw error;
  }
}


// ============================================================
// AUTOMATIC CATCH-UP POLICY
// ============================================================

function chooseScheduledScanSize(
  blocksBehind
) {
  if (
    !Number.isFinite(
      blocksBehind
    ) ||
    blocksBehind <= 0
  ) {
    return NORMAL_SCAN_BLOCKS;
  }

  if (
    blocksBehind > 2000
  ) {
    return AGGRESSIVE_SCAN_BLOCKS;
  }

  if (
    blocksBehind > 250
  ) {
    return CATCHUP_SCAN_BLOCKS;
  }

  return NORMAL_SCAN_BLOCKS;
}


// ============================================================
// INDEXER STATE
// ============================================================

function determineIndexerState(
  blocksBehind,
  lastScheduledRun,
  lastErrorAt
) {
  /*
   * Brak cursora = jeszcze nie możemy określić
   * stanu synchronizacji.
   */

  if (
    blocksBehind === null ||
    !Number.isFinite(
      blocksBehind
    )
  ) {
    return "unknown";
  }

  /*
   * Jeśli Cron nie uruchomił się od ponad 15 minut,
   * traktujemy indexer jako stalled.
   *
   * Cron jest obecnie planowany co 5 minut.
   */

  if (lastScheduledRun) {
    const lastRunTime =
      Date.parse(
        lastScheduledRun
      );

    if (
      Number.isFinite(
        lastRunTime
      )
    ) {
      const ageMs =
        Date.now() -
        lastRunTime;

      if (
        ageMs >
        15 * 60 * 1000
      ) {
        return "stalled";
      }
    }
  }

  /*
   * Świeży błąd indexera również oznacza problem.
   */

  if (lastErrorAt) {
    const errorTime =
      Date.parse(
        lastErrorAt
      );

    if (
      Number.isFinite(
        errorTime
      )
    ) {
      const errorAgeMs =
        Date.now() -
        errorTime;

      if (
        errorAgeMs <
        15 * 60 * 1000
      ) {
        return "error";
      }
    }
  }

  /*
   * Niewielka różnica jest normalna.
   *
   * Cron działa co kilka minut, więc indexer nie musi
   * przez cały czas wskazywać dokładnie 0.
   */

  if (
    blocksBehind <= 250
  ) {
    return "synced";
  }

  return "catching_up";
}


// ============================================================
// MAIN INDEXER
// ============================================================

async function scanHive(
  env,
  requestedBlocks
) {
  const props =
    await hiveRpc(
      "condenser_api.get_dynamic_global_properties",
      []
    );

  const headBlock =
    Number(
      props.head_block_number
    );

  const irreversibleBlock =
    Number(
      props.last_irreversible_block_num
    );

  if (
    !Number.isInteger(
      irreversibleBlock
    ) ||
    irreversibleBlock <= 0
  ) {
    throw new Error(
      "Hive RPC returned invalid last irreversible block."
    );
  }

  const storedLastBlock =
    await getMeta(
      env.DB,
      "last_scanned_block"
    );

  let startBlock;

  if (
    storedLastBlock !== null
  ) {
    startBlock =
      Number(
        storedLastBlock
      ) + 1;
  } else {
    /*
     * Zabezpieczenie dla nowej bazy.
     *
     * Produkcyjna baza ma już ustawiony cursor.
     */

    startBlock =
      Math.max(
        1,
        irreversibleBlock -
        requestedBlocks +
        1
      );
  }


  // ----------------------------------------------------------
  // ALREADY CAUGHT UP
  // ----------------------------------------------------------

  if (
    startBlock >
    irreversibleBlock
  ) {
    const countResult =
      await env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM census_current
      `).first();

    return {
      message:
        "Indexer is already caught up to the last irreversible block.",

      start_block:
        null,

      end_block:
        null,

      head_block_number:
        headBlock,

      last_irreversible_block_num:
        irreversibleBlock,

      last_scanned_block:
        storedLastBlock === null
          ? null
          : Number(
              storedLastBlock
            ),

      blocks_behind:
        0,

      blocks_scanned:
        0,

      transactions_scanned:
        0,

      operations_scanned:
        0,

      census_operations:
        0,

      valid_census_operations:
        0,

      invalid_census_operations:
        0,

      set_operations:
        0,

      unset_operations:
        0,

      active_census_accounts:
        Number(
          countResult?.count || 0
        )
    };
  }


  const requestedEndBlock =
    Math.min(
      irreversibleBlock,
      startBlock +
      requestedBlocks -
      1
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


  let finalLastBlock =
    startBlock - 1;


  // ----------------------------------------------------------
  // BLOCK BATCHES
  // ----------------------------------------------------------
  //
  // Każda paczka jest niezależna.
  //
  // Po jej prawidłowym przetworzeniu cursor jest natychmiast
  // zapisywany do D1.
  //
  // Jeżeli Worker padnie podczas następnej paczki, po kolejnym
  // uruchomieniu zacznie od ostatniego zapisanego miejsca.
  // ----------------------------------------------------------

  for (
    let batchStart =
      startBlock;

    batchStart <=
      requestedEndBlock;

    batchStart +=
      BLOCK_BATCH_SIZE
  ) {
    const count =
      Math.min(
        BLOCK_BATCH_SIZE,
        requestedEndBlock -
        batchStart +
        1
      );

    const response =
      await hiveRpc(
        "block_api.get_block_range",
        {
          starting_block_num:
            batchStart,

          count
        }
      );

    const blocks =
      Array.isArray(
        response?.blocks
      )
        ? response.blocks
        : [];

    if (
      blocks.length === 0
    ) {
      throw new Error(
        `Hive RPC returned no blocks starting at ${batchStart}.`
      );
    }


    // --------------------------------------------------------
    // PROCESS BATCH
    // --------------------------------------------------------

    for (
      let i = 0;
      i < blocks.length;
      i++
    ) {
      const block =
        blocks[i];

      const blockNum =
        batchStart + i;

      await processBlock(
        env.DB,
        block,
        blockNum,
        stats
      );

      stats.blocks_scanned++;

      finalLastBlock =
        blockNum;
    }


    // --------------------------------------------------------
    // SAVE CURSOR
    // --------------------------------------------------------

    await setMeta(
      env.DB,
      "last_scanned_block",
      String(
        finalLastBlock
      )
    );

    /*
     * Dodatkowa diagnostyka.
     */

    await setMeta(
      env.DB,
      "last_batch_completed_at",
      new Date().toISOString()
    );

    console.log(
      "Hive Census batch completed:",
      JSON.stringify({
        batch_start:
          batchStart,

        batch_end:
          finalLastBlock,

        target_end:
          requestedEndBlock
      })
    );


    /*
     * Jeżeli RPC zwróciło mniej bloków niż prosiliśmy,
     * nie próbujemy przeskoczyć brakującego zakresu.
     */

    if (
      blocks.length <
      count
    ) {
      break;
    }
  }


  // ----------------------------------------------------------
  // CURRENT CHAIN STATE
  // ----------------------------------------------------------
  //
  // Podczas dłuższego skanu Hive mógł wyprodukować nowe bloki.
  // Dlatego po skanowaniu pobieramy aktualny LIB ponownie.
  // ----------------------------------------------------------

  const finalProps =
    await hiveRpc(
      "condenser_api.get_dynamic_global_properties",
      []
    );

  const finalHeadBlock =
    Number(
      finalProps.head_block_number
    );

  const finalIrreversibleBlock =
    Number(
      finalProps.last_irreversible_block_num
    );

  const blocksBehind =
    Math.max(
      0,
      finalIrreversibleBlock -
      finalLastBlock
    );


  const countResult =
    await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM census_current
    `).first();


  return {
    start_block:
      startBlock,

    end_block:
      finalLastBlock,

    requested_end_block:
      requestedEndBlock,

    head_block_number:
      finalHeadBlock,

    last_irreversible_block_num:
      finalIrreversibleBlock,

    last_scanned_block:
      finalLastBlock,

    blocks_behind:
      blocksBehind,

    ...stats,

    active_census_accounts:
      Number(
        countResult?.count || 0
      )
  };
}


// ============================================================
// BLOCK PROCESSING
// ============================================================

async function processBlock(
  db,
  block,
  blockNum,
  stats
) {
  const transactions =
    Array.isArray(
      block?.transactions
    )
      ? block.transactions
      : [];

  const transactionIds =
    Array.isArray(
      block?.transaction_ids
    )
      ? block.transaction_ids
      : [];

  for (
    let txIndex = 0;
    txIndex <
      transactions.length;
    txIndex++
  ) {
    const tx =
      transactions[
        txIndex
      ];

    stats.transactions_scanned++;

    const operations =
      Array.isArray(
        tx?.operations
      )
        ? tx.operations
        : [];

    const trxId =
      transactionIds[
        txIndex
      ] || null;

    for (
      let opIndex = 0;
      opIndex <
        operations.length;
      opIndex++
    ) {
      const operation =
        operations[
          opIndex
        ];

      stats.operations_scanned++;

      const parsed =
        parseCustomJsonOperation(
          operation
        );

      if (!parsed) {
        continue;
      }

      if (
        parsed.id !==
        CENSUS_ID
      ) {
        continue;
      }

      stats.census_operations++;

      const account =
        getPostingAccount(
          parsed
        );

      if (!account) {
        stats.invalid_census_operations++;
        continue;
      }

      let payload;

      try {
        payload =
          typeof parsed.json ===
          "string"
            ? JSON.parse(
                parsed.json
              )
            : parsed.json;
      } catch {
        stats.invalid_census_operations++;
        continue;
      }

      if (
        !payload ||
        payload.v !==
          PROTOCOL_VERSION
      ) {
        stats.invalid_census_operations++;
        continue;
      }


      // ------------------------------------------------------
      // SET
      // ------------------------------------------------------

      if (
        payload.action ===
        "set"
      ) {
        if (
          !isValidSetPayload(
            payload
          )
        ) {
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


      // ------------------------------------------------------
      // UNSET
      // ------------------------------------------------------

      if (
        payload.action ===
        "unset"
      ) {
        if (
          !isValidUnsetPayload(
            payload
          )
        ) {
          stats.invalid_census_operations++;
          continue;
        }

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

function parseCustomJsonOperation(
  operation
) {
  // Legacy / condenser format

  if (
    Array.isArray(
      operation
    ) &&
    operation.length === 2
  ) {
    const [
      type,
      value
    ] = operation;

    if (
      (
        type ===
          "custom_json" ||
        type ===
          "custom_json_operation"
      ) &&
      value &&
      typeof value ===
        "object"
    ) {
      return value;
    }

    return null;
  }


  // AppBase format

  if (
    operation &&
    typeof operation ===
      "object" &&
    (
      operation.type ===
        "custom_json_operation" ||
      operation.type ===
        "custom_json"
    ) &&
    operation.value &&
    typeof operation.value ===
      "object"
  ) {
    return operation.value;
  }

  return null;
}


// ============================================================
// SIGNER
// ============================================================

function getPostingAccount(
  operation
) {
  const posting =
    operation.required_posting_auths;

  if (
    !Array.isArray(
      posting
    )
  ) {
    return null;
  }

  if (
    posting.length !== 1
  ) {
    return null;
  }

  const account =
    posting[0];

  if (
    typeof account !==
      "string" ||
    account.trim() === ""
  ) {
    return null;
  }

  return account.trim();
}


// ============================================================
// PROTOCOL v1 — SET VALIDATION
// ============================================================

function isValidSetPayload(
  payload
) {
  if (
    payload.v !== 1 ||
    payload.action !==
      "set"
  ) {
    return false;
  }

  if (
    typeof payload.country !==
      "string" ||
    !/^[A-Z]{2}$/.test(
      payload.country
    )
  ) {
    return false;
  }

  if (
    typeof payload.country_name !==
      "string" ||
    payload.country_name.trim() ===
      ""
  ) {
    return false;
  }

  if (
    payload.region !== null &&
    payload.region !==
      undefined &&
    typeof payload.region !==
      "string"
  ) {
    return false;
  }

  if (
    payload.region_name !== null &&
    payload.region_name !==
      undefined &&
    typeof payload.region_name !==
      "string"
  ) {
    return false;
  }

  if (
    typeof payload.city !==
      "string" ||
    payload.city.trim() === ""
  ) {
    return false;
  }

  if (
    typeof payload.lat !==
      "number" ||
    !Number.isFinite(
      payload.lat
    ) ||
    payload.lat < -90 ||
    payload.lat > 90
  ) {
    return false;
  }

  if (
    typeof payload.lon !==
      "number" ||
    !Number.isFinite(
      payload.lon
    ) ||
    payload.lon < -180 ||
    payload.lon > 180
  ) {
    return false;
  }

  return true;
}


// ============================================================
// PROTOCOL v1 — UNSET VALIDATION
// ============================================================

function isValidUnsetPayload(
  payload
) {
  return (
    payload &&
    payload.v === 1 &&
    payload.action ===
      "unset"
  );
}


// ============================================================
// DATABASE — SET
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
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP
    )

    ON CONFLICT(account)
    DO UPDATE SET
      country =
        excluded.country,
      country_name =
        excluded.country_name,
      region =
        excluded.region,
      region_name =
        excluded.region_name,
      city =
        excluded.city,
      lat =
        excluded.lat,
      lon =
        excluded.lon,
      block_num =
        excluded.block_num,
      trx_id =
        excluded.trx_id,
      updated_at =
        CURRENT_TIMESTAMP

    WHERE
      excluded.block_num >=
      census_current.block_num
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


// ============================================================
// DATABASE — UNSET
// ============================================================

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
    .bind(
      account,
      blockNum
    )
    .run();
}


// ============================================================
// DATABASE — META
// ============================================================

async function getMeta(
  db,
  key
) {
  const row =
    await db.prepare(`
      SELECT value
      FROM census_meta
      WHERE key = ?
    `)
      .bind(
        key
      )
      .first();

  return row
    ? row.value
    : null;
}


async function setMeta(
  db,
  key,
  value
) {
  await db.prepare(`
    INSERT INTO census_meta (
      key,
      value
    )
    VALUES (?, ?)

    ON CONFLICT(key)
    DO UPDATE SET
      value =
        excluded.value
  `)
    .bind(
      key,
      String(value)
    )
    .run();
}


// ============================================================
// INDEXER ERROR DIAGNOSTICS
// ============================================================

async function recordIndexerError(
  db,
  error
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const now =
    new Date().toISOString();

  /*
   * Nie chcemy, aby awaria samego zapisu diagnostyki
   * przesłoniła pierwotny błąd indexera.
   */

  try {
    await setMeta(
      db,
      "last_error",
      message
    );

    await setMeta(
      db,
      "last_error_at",
      now
    );

  } catch (
    diagnosticError
  ) {
    console.error(
      "Failed to record indexer error:",
      diagnosticError
    );
  }
}


async function clearIndexerError(
  db
) {
  /*
   * Zachowujemy klucze w tabeli, ale czyścimy wartości.
   */

  await setMeta(
    db,
    "last_error",
    ""
  );

  await setMeta(
    db,
    "last_error_at",
    ""
  );
}


// ============================================================
// HIVE RPC
// ============================================================

async function hiveRpc(
  method,
  params
) {
  const response =
    await fetch(
      HIVE_RPC,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            jsonrpc:
              "2.0",

            method,

            params,

            id:
              1
          })
      }
    );

  if (!response.ok) {
    throw new Error(
      `Hive RPC HTTP error ${response.status}.`
    );
  }

  const data =
    await response.json();

  if (data.error) {
    throw new Error(
      `Hive RPC error: ${JSON.stringify(
        data.error
      )}`
    );
  }

  if (
    data.result ===
    undefined
  ) {
    throw new Error(
      `Hive RPC returned no result for ${method}.`
    );
  }

  return data.result;
}


// ============================================================
// HTTP HELPERS
// ============================================================

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}


function errorResponse(
  error
) {
  console.error(
    error
  );

  return json(
    {
      ok:
        false,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    },
    500
  );
}
