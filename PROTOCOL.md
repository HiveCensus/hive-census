# Hive Census Protocol v1 — draft

## Purpose
Hive Census is an open convention for publishing a Hive account's self-declared geographic location through Hive `custom_json`.

## Operation ID
`hive_census`

## Authority
Posting authority.

## Current v1 actions

### `set`
```json
{
  "v": 1,
  "action": "set",
  "country": "PL",
  "region": "Silesian Voivodeship",
  "city": "Katowice",
  "lat": 50.26490,
  "lon": 19.02380
}
```

The location is self-declared and is not proof of residence. Clients should use a locality centre rather than a user's precise GPS/home coordinates.

### `unset`
```json
{
  "v": 1,
  "action": "unset"
}
```

`unset` means that conforming clients should treat the account as having no current Census location. Earlier blockchain operations remain permanently public.

## State rule
For each Hive account, the latest valid `hive_census` operation determines current Census state. Blockchain ordering, not a client-supplied timestamp, determines recency.

## Privacy
A client MUST clearly warn users before `set` that data published to Hive is public and cannot truly be deleted. A client SHOULD NOT request precise device GPS coordinates.

## Status
Draft. Freeze the schema before public production use.
