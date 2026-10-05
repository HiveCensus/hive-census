const HIVE_RPC = "https://api.hive.blog";
const CENSUS_ID = "hive_census";
const PROTOCOL_VERSION = 1;
const VERSION = "0.7.1";

const DEFAULT_MANUAL_SCAN_BLOCKS = 500;
const MAX_MANUAL_SCAN_BLOCKS = 1000;

const NORMAL_SCAN_BLOCKS = 250;
const CATCHUP_SCAN_BLOCKS = 600;
const AGGRESSIVE_SCAN_BLOCKS = 1000;

const BLOCK_BATCH_SIZE = 100;


/*
 * WORKER
 */

export default {

  async fetch(request, env) {
    const url = new URL(request.url);

    try {

      /*
       * SERVICE STATUS
       */

      if (url.pathname === "/api/status") {
        return jsonResponse({
          ok: true,
          service: "Hive Census",
          version: VERSION,
          database: !!env.DB,
          assets: !!env.ASSETS
        });
      }


      /*
       * CURRENT CENSUS
       */

      if (url.pathname === "/api/census") {
        if (!env.DB) {
          return jsonResponse(
            {
              ok: false,
              error: "Database binding unavailable."
            },
            500
          );
        }

        const result = await env.DB
          .prepare(`
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
              country_name COLLATE NOCASE,
              region_name COLLATE NOCASE,
              city COLLATE NOCASE,
              account COLLATE NOCASE
          `)
          .all();

        return jsonResponse({
          ok: true,
          census: result.results || []
        });
      }


      /*
       * INDEXER STATUS
       */

      if (url.pathname === "/api/indexer/status") {
        if (!env.DB) {
          return jsonResponse(
            {
              ok: false,
              error: "Database binding unavailable."
            },
            500
          );
        }

        const dynamicProps =
          await getDynamicGlobalProperties();

        const lastScannedBlock =
          await getMetaNumber(
            env.DB,
            "last_scanned_block"
          );

        const censusAccounts =
          await countCensusAccounts(
            env.DB
          );

        const lastScheduledRun =
          await getMeta(
            env.DB,
            "last_scheduled_run"
          );

        const lastSuccessfulScan =
          await getMeta(
            env.DB,
            "last_successful_scan"
          );

        const lastError =
          await getMeta(
            env.DB,
            "last_error"
         
