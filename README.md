# Hive Census

**Where in the world is Hive?**

Hive Census is an experimental, open, on-chain map of self-declared Hive community locations.

This repository contains the first MVP frontend and the draft Hive Census Protocol v1.

## Current MVP
- static Cloudflare Workers site
- OpenStreetMap/Leaflet map
- city/town search
- Hive Keychain detection
- preview of the exact `custom_json`
- `hive_census` broadcast using Posting authority
- permanent-public-data warning

## Not yet implemented
- blockchain-wide Census indexer
- live map of existing Census records
- `unset` UI
- country/region-only declarations
- production-grade geocoder/tile provider and rate limiting

## Deploy on Cloudflare Workers
The repository includes `wrangler.jsonc`. Cloudflare's deploy command can remain:

`npx wrangler deploy`

No build command is required for this static MVP.

## Important
This is an MVP. Do not treat the protocol draft as frozen until `PROTOCOL.md` is reviewed and version 1.0 is explicitly released.
