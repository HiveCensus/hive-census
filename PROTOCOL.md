# Hive Census Protocol v1.0

## Status

**Protocol version:** 1  
**Custom JSON ID:** `hive_census`  
**Hive authority:** Posting  
**Status:** Draft for implementation

Hive Census is an open protocol for publishing self-declared locality information by Hive accounts.

The Hive blockchain is the source of truth. The Hive Census website is only one possible interface for creating and reading Census declarations.

Any application may implement this protocol without permission from the operators of the Hive Census website.

---

# 1. Purpose

Hive Census allows a Hive account to publicly declare its current city, town, village or other locality.

A Census declaration means:

> The Hive account signing this operation declares this locality as its current place of residence.

Hive Census does not verify whether the declaration is factually correct.

A valid Hive signature establishes which Hive account made the declaration. It does not establish that the declared location is true.

Hive Census must therefore describe locations as **self-declared locations**, not verified locations.

---

# 2. Privacy model

Hive Census stores declarations on the public Hive blockchain.

Hive is an immutable public blockchain. Once a declaration has been published, its historical blockchain operation cannot be deleted by Hive Census.

Users MUST be informed of this before publishing a declaration.

Hive Census is designed to store a **locality**, not:

- a street address;
- a building;
- geographic coordinates of a user's home;
- device GPS coordinates;
- a user's current physical position.

Coordinates contained in a Census declaration MUST represent the selected locality, not the precise location of the user.

Users should never publish information they do not want permanently associated with their Hive account in public blockchain history.

---

# 3. Hive operation

Hive Census v1 uses a Hive `custom_json` operation.

The operation ID is:

```text
hive_census
```

The operation MUST be authorized using the Hive account's **Posting authority**.

The account making the declaration is determined from the Hive authorization of the `custom_json` operation.

The account name MUST NOT be duplicated inside the Census JSON payload.

---

# 4. Protocol version

Every Hive Census v1 payload MUST contain:

```json
{
  "v": 1
}
```

Clients implementing this specification MUST interpret `v: 1` according to this document.

Clients MUST NOT automatically interpret an unknown future protocol version as v1.

This permits future versions of Hive Census to introduce new semantics without changing the meaning of existing v1 operations.

---

# 5. Actions

Hive Census Protocol v1 defines two actions:

```text
set
unset
```

`set` creates or replaces the current Census declaration of an account.

`unset` removes the account from the current Census state.

No other actions are defined by Protocol v1.

---

# 6. The `set` action

A complete example:

```json
{
  "v": 1,
  "action": "set",
  "country": "PL",
  "country_name": "Poland",
  "region": "PL-24",
  "region_name": "Silesian Voivodeship",
  "city": "Katowice",
  "lat": 50.2649,
  "lon": 19.0238
}
```

The fields have the following meanings.

## `v`

Protocol version.

For this specification:

```json
"v": 1
```

is required.

---

## `action`

For a location declaration:

```json
"action": "set"
```

is required.

---

## `country`

Two-letter country code based on ISO 3166-1 alpha-2.

Example:

```json
"country": "PL"
```

Country codes SHOULD use uppercase ASCII letters.

---

## `country_name`

Human-readable country name associated with `country`.

Example:

```json
"country_name": "Poland"
```

This field allows clients to display a useful location description without depending on the same geocoding provider that was used when the declaration was created.

---

## `region`

ISO 3166-2 subdivision code, where such a code can be reliably determined.

Example:

```json
"region": "PL-24"
```

For the example above, `PL-24` identifies Silesian Voivodeship.

If an appropriate subdivision code cannot be reliably determined, the value MUST be:

```json
"region": null
```

The absence of an ISO 3166-2 code MUST NOT prevent a user from participating in Hive Census.

---

## `region_name`

Human-readable name of the relevant administrative region.

Example:

```json
"region_name": "Silesian Voivodeship"
```

If no meaningful regional name can be determined, the value MAY be:

```json
"region_name": null
```

Hive Census MUST NOT assume that every country uses an administrative structure equivalent to Polish voivodeships.

---

## `city`

Human-readable name of the selected locality.

Example:

```json
"city": "Katowice"
```

Despite the field name `city`, this field represents the Census locality and MAY therefore contain a city, town, village or another recognized inhabited locality.

The locality name MUST NOT be replaced with a street address or other precise residential information.

---

## `lat`

Latitude of the representative point of the selected locality.

Example:

```json
"lat": 50.2649
```

It MUST be a JSON number between:

```text
-90 and 90
```

inclusive.

It MUST represent the locality rather than the user's device or residence.

Hive Census v1 clients SHOULD store coordinates with no more than four decimal places.

---

## `lon`

Longitude of the representative point of the selected locality.

Example:

```json
"lon": 19.0238
```

It MUST be a JSON number between:

```text
-180 and 180
```

inclusive.

It MUST represent the locality rather than the user's device or residence.

Hive Census v1 clients SHOULD store coordinates with no more than four decimal places.

---

# 7. Region without an ISO code

A valid declaration may contain a human-readable region even when an ISO 3166-2 code is unavailable.

Example:

```json
{
  "v": 1,
  "action": "set",
  "country": "XX",
  "country_name": "Example Country",
  "region": null,
  "region_name": "Example Province",
  "city": "Example City",
  "lat": 12.3456,
  "lon": 23.4567
}
```

The absence of a region code does not invalidate the declaration.

---

# 8. Locality without a region

A declaration may also be valid when neither a regional code nor a meaningful regional name is available.

Example:

```json
{
  "v": 1,
  "action": "set",
  "country": "XX",
  "country_name": "Example Country",
  "region": null,
  "region_name": null,
  "city": "Example City",
  "lat": 12.3456,
  "lon": 23.4567
}
```

The minimum geographic information required by a `set` operation is therefore:

```text
country
country_name
city
lat
lon
```

together with:

```text
v
action
```

The `region` and `region_name` fields remain part of the payload but MAY contain `null` as specified above.

---

# 9. Locality selection

Hive Census clients SHOULD require the user to select a recognized locality rather than accepting an arbitrary unstructured location string.

Search results SHOULD provide sufficient geographic context to distinguish localities with identical or similar names.

For example:

```text
Katowice, Silesian Voivodeship, Poland
```

rather than simply:

```text
Katowice
```

The user should be able to verify the locality, administrative region and country before signing the declaration.

The presentation name does not determine the identity of the Hive account and is not proof that the user actually resides there.

---

# 10. Geocoding independence

Hive Census Protocol MUST NOT depend on one particular geocoding provider.

A client MAY use services such as OpenStreetMap-based geocoding or another geographic database to help the user select a locality.

Provider-specific identifiers MUST NOT be required by Protocol v1.

For example, the protocol does not define fields such as:

```text
nominatim_id
google_place_id
```

The blockchain declaration should remain useful even if the original geocoding service later changes or disappears.

The combination of:

```text
country
region
city
lat
lon
```

provides geographic context for the locality without making the protocol dependent on a single provider.

---

# 11. Current state

Hive Census represents **current state**, not location history.

For each Hive account, only its latest valid Hive Census operation determines its current Census state.

For example:

```text
set: Katowice
set: Kraków
set: Warsaw
```

results in the current Census state:

```text
Warsaw
```

The earlier locations MUST NOT be presented by compliant Hive Census clients as the account's current locations.

Hive Census clients SHOULD NOT provide a location-history feature based on superseded Census declarations.

However, previous operations remain permanently available in Hive blockchain history. The protocol cannot erase or make those historical blockchain operations private.

---

# 12. The `unset` action

A Hive account may withdraw from the current Census state by publishing:

```json
{
  "v": 1,
  "action": "unset"
}
```

After a valid `unset` becomes the latest Census operation for an account:

- the account has no active Hive Census declaration;
- it MUST NOT appear as an active user on the Census map;
- it MUST NOT be included in current geographic Census statistics.

An `unset` operation does **not** delete previous blockchain operations.

Clients MUST clearly communicate this distinction to users.

---

# 13. Rejoining after `unset`

An account that previously published `unset` MAY later publish another valid `set`.

For example:

```text
set: Katowice
unset
set: Kraków
```

results in the current Census state:

```text
Kraków
```

The latest valid operation determines the current state.

---

# 14. Operation ordering

Hive Census does not use a client-provided timestamp to determine current state.

Protocol v1 therefore does not define a `timestamp` field.

The authoritative order of declarations is their order on the Hive blockchain.

An indexer MUST use blockchain ordering when determining which valid operation is the latest operation for an account.

A client-generated timestamp MUST NOT override blockchain ordering.

---

# 15. Validation

A Protocol v1 `set` operation is valid only if the required fields conform to this specification.

At minimum:

```text
v             integer equal to 1
action        string equal to "set"
country       valid two-letter country code
country_name  non-empty string
region        string containing an applicable subdivision code, or null
region_name   non-empty string, or null
city          non-empty string
lat           JSON number between -90 and 90
lon           JSON number between -180 and 180
```

A Protocol v1 `unset` operation requires:

```text
v             integer equal to 1
action        string equal to "unset"
```

A malformed or invalid operation remains part of the Hive blockchain but MUST NOT change the current Hive Census state.

Clients and indexers MUST NOT silently guess missing required values or reinterpret malformed operations as valid declarations.

---

# 16. Account identity

The identity of the declarant is derived from the Hive account authorizing the `custom_json` operation.

The payload therefore MUST NOT require a field such as:

```json
{
  "account": "example"
}
```

This prevents the JSON content from independently claiming an identity different from the blockchain authorization.

A Census indexer MUST derive account identity from the Hive operation itself.

---

# 17. Self-declaration and verification

Hive Census does not verify residency.

A declaration such as:

```text
@example → Katowice, Silesian Voivodeship, Poland
```

means:

> The Hive account `@example` declared Katowice as its current place of residence.

It does not mean:

> Hive Census verified that the person controlling `@example` lives in Katowice.

The cryptographic authorization proves control of the relevant Hive authority at the time of the operation. It does not prove the truth of the geographic statement.

---

# 18. False declarations

Protocol v1 does not define a mechanism for determining whether a declaration is false.

A technically valid declaration SHOULD remain part of the current protocol state until the same account replaces it with another valid operation.

Applications MAY implement separate anti-abuse or presentation policies, but such policies MUST NOT be represented as changes to the underlying signed declaration.

The protocol records what an account declared, not whether the declaration is true.

---

# 19. Sybil resistance

Hive Census Protocol v1 does not attempt to prove that one Hive account corresponds to one natural person.

Therefore:

```text
one Hive account = one current Census declaration
```

does not mean:

```text
one Hive account = one human being
```

Statistics derived from Census data MUST NOT automatically be described as a verified count of unique people.

They represent participating Hive accounts unless an application applies and clearly discloses additional methodology.

---

# 20. Current Census statistics

Current geographic statistics MUST be calculated from the current state of participating accounts.

Superseded `set` operations MUST NOT be counted.

Accounts whose latest valid operation is `unset` MUST NOT be counted.

For example, if an account publishes:

```text
Katowice → Kraków
```

it contributes one active declaration to Kraków and zero active declarations to Katowice.

---

# 21. Immutability and withdrawal

There is an important distinction between:

```text
blockchain history
```

and:

```text
current Hive Census state
```

Hive Census can change the second but cannot erase the first.

`set` replaces the previous active state.

`unset` removes the account from active state.

Neither operation deletes historical Hive transactions.

Clients MUST NOT describe `unset` as deletion of blockchain data.

---

# 22. Client requirements

A client that publishes Hive Census v1 declarations SHOULD:

1. identify the Hive account that will sign the operation;
2. use Hive Posting authority;
3. allow the user to search for and select a locality;
4. show sufficient administrative context to identify the locality;
5. avoid requesting precise GPS location;
6. show the exact declaration before signing;
7. clearly warn that the blockchain operation is public and permanent;
8. require an explicit user action before broadcasting;
9. never request or store the user's Hive private keys;
10. use a compatible signing mechanism such as Hive Keychain.

The client SHOULD display a selected locality in a form similar to:

```text
Katowice, Silesian Voivodeship, Poland
```

---

# 23. Indexer requirements

A Hive Census v1 indexer SHOULD:

1. read Hive `custom_json` operations with ID `hive_census`;
2. identify the author from the operation's Hive authorization;
3. parse the JSON payload;
4. validate the payload against Protocol v1;
5. process operations in authoritative blockchain order;
6. retain only the latest valid current state for each account;
7. replace previous state when a later valid `set` is processed;
8. remove active state when a later valid `unset` is processed;
9. ignore malformed operations for purposes of current Census state;
10. keep protocol-version handling explicit.

An indexer MAY internally retain blockchain positions or historical operations for technical synchronization purposes.

Such internal retention does not make historical locations part of the Hive Census current-state data model.

---

# 24. Example lifecycle

First declaration:

```json
{
  "v": 1,
  "action": "set",
  "country": "PL",
  "country_name": "Poland",
  "region": "PL-24",
  "region_name": "Silesian Voivodeship",
  "city": "Katowice",
  "lat": 50.2649,
  "lon": 19.0238
}
```

Current state:

```text
Katowice, Silesian Voivodeship, Poland
```

The same account later publishes a valid declaration for Kraków.

Current state becomes:

```text
Kraków, Lesser Poland Voivodeship, Poland
```

Katowice is no longer part of that account's current Census state.

The account then publishes:

```json
{
  "v": 1,
  "action": "unset"
}
```

Current state becomes:

```text
No active Hive Census declaration
```

Historical operations remain available on the Hive blockchain.

---

# 25. Extensibility

Protocol v1 intentionally contains a small set of fields and actions.

Future functionality SHOULD be introduced through a new protocol version when it would change the semantics or required structure of Census declarations.

A future version may extend the protocol without changing the interpretation of valid v1 operations.

Clients MUST NOT assume that unknown versions have v1 semantics.

---

# 26. Source of truth

The Hive blockchain is the authoritative source of Hive Census declarations.

A website database, cache, API or indexer is only a derived representation of blockchain state.

No particular Hive Census website, server or organization is required for the protocol to function.

A compatible implementation should be able to reconstruct current Hive Census state by processing valid `hive_census` operations from the Hive blockchain.

---

# 27. Protocol principle

> The website is an interface. The blockchain is the record.

Hive Census is intended to remain readable and implementable independently of any single website, database, geocoding provider or application.
