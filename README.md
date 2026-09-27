# Hive Census

**Where in the world is Hive?**

Hive Census is an experimental, open, on-chain map of the Hive community.

It allows Hive users to voluntarily declare their current city or town and publish that declaration to the Hive blockchain using their Hive account.

The website is only an interface. The Hive blockchain is intended to be the source of truth.

## Current version

**Hive Census v0.2**

This is an early MVP.

### Current features

- Responsive desktop and mobile interface
- Hive visual identity
- Interactive map based on Leaflet and OpenStreetMap
- City and town search
- Hive Keychain detection
- Preview of the exact `custom_json` payload
- Clear warning that blockchain records are public and permanent
- No GPS or precise device location required

## Publishing status

Real blockchain publishing is intentionally disabled in v0.2.

The Hive Census Protocol v1.0 will be finalized before the first production `hive_census` declarations are published.

This prevents experimental or incompatible data from being permanently written to the Hive blockchain while the protocol is still being developed.

## How Hive Census works

A user:

1. Connects a Hive account through Hive Keychain.
2. Searches for their city or town.
3. Reviews the location and the exact data that will be published.
4. Approves a Hive `custom_json` operation using Posting authority.
5. The declaration becomes part of the public Hive blockchain.

Hive Census does not require a separate user account or password.

The website never needs access to the user's private Hive keys. Signing is handled by Hive Keychain.

## Privacy

Hive Census is designed around voluntary, self-declared location information.

The protocol is intended to store a locality such as a city or town — not a home address and not the user's precise GPS position.

However, Hive is a public and immutable blockchain.

Publishing a Census declaration permanently associates the Hive account signing the operation with the declared location in blockchain history.

A later `unset` operation may remove the declaration from the current Census state, but it cannot erase the historical blockchain operation.

Users should therefore never publish information they do not want to remain publicly accessible.

## Protocol

Hive Census uses Hive `custom_json` operations.

Planned protocol identifier:

`hive_census`

Authority:

`Posting`

Protocol specification:

See `PROTOCOL.md`.

The protocol is intended to be open. Any developer should be able to build another website, application, map or indexer capable of reading compatible Hive Census declarations directly from the Hive blockchain.

## Architecture

The project currently consists of:

- static frontend
- Hive Keychain integration
- Leaflet
- OpenStreetMap
- locality geocoding
- Hive `custom_json` protocol

An on-chain indexer will be added to reconstruct the current Census state from Hive blockchain operations and display community locations on the map.

## Project structure

```text
hive-census/
├── public/
│   ├── assets/
│   │   └── hive-logo.png
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── PROTOCOL.md
├── README.md
└── wrangler.jsonc
