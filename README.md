
# Hive Census

**Where in the world is Hive?**

Hive Census is an experimental, open-source project designed to create a geographical map of the Hive community.

The application combines two sources of geographical information:

1. **Voluntary on-chain declarations** — locations explicitly published by Hive users through the Hive Census protocol.
2. **Public Hive profile locations** — geographical information voluntarily entered in users' public Hive account profiles.

The goal is to help the community understand its geographical distribution, discover regional concentrations of Hive users and support the organisation of community events such as HiveFest and HiveBeeCon.

**Live application:** https://app.hive-census.workers.dev/

Hive Census is not a census of unique individuals. One person may operate multiple Hive accounts, and profile information may be incomplete, outdated or inaccurate.

---

## Current version

**Hive Census v0.9.11**

**Status:** Active development / Experimental

The application is operational, but several background processes and administrative features remain under development or require additional testing.

### Current features

- Responsive desktop and mobile interface
- Interactive geographical map using Leaflet and OpenStreetMap
- Hive Keychain integration
- Hive Census `custom_json` protocol support
- Blockchain indexer for Hive Census declarations
- Incremental import of public Hive account profiles
- Automatic extraction and normalisation of profile locations
- Location classification and geographical matching
- GeoNames geocoding integration
- Detection of ambiguous and unresolved locations
- Administrative review and manual resolution of geographical matches
- Account-specific location overrides
- Administrator authentication through Hive Keychain
- Cloudflare D1 database integration
- Scheduled background processing through Cloudflare Cron Triggers
- Public API endpoints for census data, profile locations and processing statistics
- Manual full-profile rescan mechanism, subject to completion of the initial import

### Development status

The initial import of Hive account profiles is still in progress.

The application can display geographical results from accounts that have already been processed. The map should therefore not be interpreted as a complete representation of all Hive accounts.

Full profile rescanning has been implemented but is not yet available until the initial import is complete. Its concurrency protections also require further integration testing.

---

## Technical documentation

A detailed technical article describing the architecture, implementation decisions, development challenges, solutions and known limitations of Hive Census is being prepared for publication on Hive.

**Technical documentation and development case study:**

**[Read the full technical documentation](INSERT_HIVE_DOCUMENTATION_POST_URL_HERE)**

The documentation covers:

- Application architecture and data flow
- Hive RPC integration and blockchain indexing
- Incremental profile importing
- Location normalisation and classification
- GeoNames integration and ambiguous geographical data
- Administrative authentication and manual corrections
- Background jobs, concurrency control and recovery mechanisms
- Cloudflare D1 schema, indexes and performance
- Problems encountered during development and how they were addressed
- Deployment, maintenance and version history
- Known issues and future improvements

The documentation is intended to help other Hive developers understand the project, reuse its technical approaches and avoid problems encountered during development.

---

## How Hive Census works

Hive Census processes geographical information through two complementary mechanisms.

### 1. On-chain Census declarations

Hive users can voluntarily publish a geographical declaration using the Hive Census protocol.

The intended workflow is:

1. Connect a Hive account through Hive Keychain.
2. Search for a city or town.
3. Review the selected location and the data to be published.
4. Authorise a Hive `custom_json` operation using Posting authority.
5. The declaration is recorded on the Hive blockchain.
6. The Hive Census indexer processes the operation and updates the current Census state.

The Hive blockchain is the source of truth for these explicit declarations.

The website is an interface for publishing and displaying them.

### 2. Public Hive profile locations

Hive Census also analyses location information already published in public Hive account profiles.

The process is:

1. Retrieve Hive accounts incrementally through Hive RPC.
2. Extract location information from public profile metadata.
3. Normalise location strings.
4. Classify geographical information.
5. Resolve supported locations using the application's classifier and GeoNames.
6. Flag ambiguous or unresolved locations.
7. Allow an administrator to review uncertain matches.
8. Display accepted geographical results on the map.

Profile locations are not equivalent to explicit Census declarations.

A profile location is free-form account metadata and may not represent the user's current place of residence.

---

## Privacy

Hive Census is designed around publicly available and voluntarily disclosed geographical information.

### On-chain declarations

The Hive Census protocol is intended to record a locality, such as a city or town, rather than a home address or precise GPS position.

However, Hive is a public and immutable blockchain.

Publishing a Census declaration permanently associates the signing Hive account with the declared location in blockchain history.

A subsequent `unset` operation may remove the declaration from the current Census state, but it cannot erase the historical blockchain operation.

### Public profile locations

Hive Census also processes location strings that users have already made publicly available through their Hive account profiles.

These strings may be inaccurate, ambiguous or outdated.

The application attempts to interpret them geographically, but it does not independently verify the physical residence or identity of an account holder.

### Authentication

Hive Census uses Hive Keychain for Hive-account authentication.

The website does not require users to disclose their private Hive keys. Signing is handled by Hive Keychain.

Users should avoid publishing geographical information they do not want associated with their public Hive identity.

---

## Hive Census Protocol

Hive Census uses Hive `custom_json` operations.

**Protocol identifier:**

`hive_census`

**Authority:**

`Posting`

**Protocol specification:**

See [PROTOCOL.md](./PROTOCOL.md).

The protocol is intended to be open and independently implementable.

Other developers should be able to build compatible websites, maps, applications and blockchain indexers without depending on the Hive Census frontend.

The on-chain protocol and the profile-location importer are separate components of the application.

---

## Architecture

Hive Census uses a serverless architecture based on Cloudflare.

### Technology stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS and JavaScript |
| Map | Leaflet |
| Map tiles | OpenStreetMap |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 |
| Background processing | Cloudflare Cron Triggers |
| Blockchain integration | Hive RPC |
| Authentication | Hive Keychain |
| Geographical classification | Custom location classifier |
| Geocoding | GeoNames |
| Hosting | Cloudflare |

### Data flow

```text
                   HIVE BLOCKCHAIN
                          |
                       Hive RPC
                          |
             +------------+------------+
             |                         |
       Census indexer           Profile importer
             |                         |
       custom_json              Account metadata
             |                         |
       Validation               Location extraction
             |                         |
       Current Census           Normalisation
             |                         |
             |                   Classification
             |                         |
             |                     GeoNames
             |                         |
             |                 Administrative review
             |                         |
             +------------+------------+
                          |
                      Cloudflare D1
                          |
                    Cloudflare Worker
                          |
                      Public API
                          |
                     Web frontend
                          |
                   Interactive map
```

### Background processing

The application uses incremental background jobs to process blockchain data, account profiles, location classification and geocoding.

Persistent cursors and metadata allow processing to continue across multiple Worker executions.

The scheduled auxiliary workloads are rotated to limit the amount of work performed during each execution.

This approach is intended to keep infrastructure requirements low while processing a large number of Hive accounts.

---

## Database

Hive Census uses Cloudflare D1, a SQLite-based database service.

Principal application tables include:

| Table | Purpose |
|---|---|
| `census_current` | Current on-chain Census declarations |
| `census_meta` | Blockchain indexer metadata |
| `profile_locations` | Location information extracted from Hive profiles |
| `profile_import_meta` | Import and rescan progress |
| `location_matches` | Normalised geographical matches |
| `location_geocode_attempts` | Geocoding attempts and outcomes |
| `profile_location_overrides` | Account-specific administrative corrections |
| `admin_auth_challenges` | Authentication challenges |
| `admin_sessions` | Administrator sessions |

The database also contains indexes supporting geographical lookups, status filtering, account matching and session expiration.

The detailed schema and database design are covered in the technical documentation.

---

## Public API

The application exposes endpoints for retrieving Census data and monitoring processing status.

| Endpoint | Description |
|---|---|
| `/api/status` | Application status |
| `/api/census` | Current on-chain Census records |
| `/api/indexer/status` | Blockchain indexer status |
| `/api/profiles/status` | Profile importer statistics |
| `/api/profiles/locations` | Stored profile location sample |
| `/api/profiles/map` | Aggregated geographical map data |
| `/api/profiles/classifier/status` | Location classifier status |
| `/api/profiles/geocoder/status` | Geocoding status |
| `/api/profiles/rescan/status` | Full profile rescan status |

Administrative operations are handled separately and require authentication.

API responses and endpoint behaviour may change during active development.

---

## Administration

Hive Census includes an administrative interface for maintaining geographical data quality.

Administrative access is restricted to the authorised Hive account through Hive Keychain authentication.

Current administrative capabilities include:

- Reviewing ambiguous geographical matches
- Manually accepting or rejecting location matches
- Applying account-specific location corrections
- Monitoring background processing
- Managing supported administrative operations

The project also includes a manually initiated full-profile rescan mechanism.

Full rescanning remains unavailable until the initial account import is complete.

---

## Development challenges

Several technical challenges have influenced the architecture of Hive Census.

### Large-scale account importing

Hive contains a substantial number of accounts.

The importer processes accounts incrementally, preserving its position between scheduled executions.

### Ambiguous geographical names

Different locations may share the same name.

Hive Census distinguishes matched, ambiguous, pending and rejected results rather than assuming that every geographical search result is correct.

### Preserving manual corrections

Automated processing must not overwrite administrator decisions without appropriate safeguards.

The application uses manual-source protection and account-specific overrides.

### Background-job concurrency

Long-running rescans require protection against simultaneous execution.

Version 0.9.11 introduces lease-based ownership, guarded database operations and recovery mechanisms.

Full integration testing of this mechanism remains outstanding.

### Infrastructure efficiency

The application is designed to operate with modest infrastructure requirements.

Cloudflare D1 usage and query plans are monitored to identify potential performance improvements.

More detailed explanations of these problems and their solutions are provided in the technical documentation linked above.

---

## Known limitations

Hive Census is experimental.

Current limitations include:

- The initial profile import is incomplete.
- Not every Hive account provides a geographical location.
- Profile locations are self-reported and not independently verified.
- Some locations are ambiguous or cannot be resolved.
- One individual may control multiple Hive accounts.
- Full profile rescanning is not yet available during the initial import.
- Rescan concurrency protections require further integration testing.
- Database performance and background scheduling may require further optimisation as usage grows.

Map statistics should therefore be interpreted as indicative rather than comprehensive demographic data.

---

## Roadmap

Planned work includes:

- [ ] Complete the initial import of Hive account profiles
- [ ] Validate the full profile rescan mechanism through integration tests
- [ ] Review and optimise Cloudflare D1 queries where measurements justify changes
- [ ] Improve background-processing efficiency
- [ ] Continue resolving ambiguous geographical locations
- [ ] Expand technical documentation and deployment instructions
- [ ] Maintain a detailed technical changelog
- [ ] Improve the accuracy and coverage of the geographical map

---

## Project structure

The repository contains the public frontend, Cloudflare Worker backend, location-processing modules, administrative functionality and protocol documentation.

The main components include:

```text
hive-census/
├── public/
│   ├── assets/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── worker-core.js
│   ├── location-classifier.js
│   ├── location-geocoder.js
│   ├── admin-api.js
│   └── admin-auth.js
├── PROTOCOL.md
├── README.md
└── wrangler.jsonc
```

This is a simplified representation of the main application components, not an exhaustive repository tree.

---

## Contributing

Hive Census is an experimental community-oriented project.

Feedback, bug reports, geographical data corrections and technical contributions are welcome.

Developers interested in Hive RPC, blockchain indexing, geolocation, Cloudflare Workers or D1 are encouraged to explore the project and its technical documentation.

Please review the protocol specification before implementing compatible Census declarations.

---

## Disclaimer

Hive Census is an independent experimental application.

Geographical information displayed by the project may be incomplete, inaccurate or outdated.

The application does not establish the real-world identity, residence or physical location of Hive account holders.

The project is provided for informational and community purposes.

---

## Links

- **Live application:** https://app.hive-census.workers.dev/
- **Protocol specification:** [PROTOCOL.md](./PROTOCOL.md)
- **Technical documentation:** [Hive Census — Technical Documentation](INSERT_HIVE_DOCUMENTATION_POST_URL_HERE)
- **Hive blockchain:** https://hive.io/

---

*Hive Census — Where in the world is Hive?*
