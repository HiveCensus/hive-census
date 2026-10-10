
import { secp256k1 } from "@noble/curves/secp256k1";

export const ADMIN_ACCOUNT = "jocieprosza";

export const ADMIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const ADMIN_SESSION_COOKIE = "hive_census_admin";

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const encoder = new TextEncoder();

function hexToBytes(hex) {
  if (
    typeof hex !== "string" ||
    hex.length === 0 ||
    hex.length % 2 !== 0 ||
    !HEX_PATTERN.test(hex)
  ) {
    throw new Error("Invalid hexadecimal value");
  }

  return Uint8Array.from(
    hex.match(/.{2}/g),
    value => parseInt(value, 16)
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function base58Decode(value) {
  if (
    typeof value !== "string" ||
    !value.length
  ) {
    throw new Error("Invalid Base58 value");
  }

  let number = 0n;

  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);

    if (digit < 0) {
      throw new Error("Invalid Base58 character");
    }

    number = number * 58n + BigInt(digit);
  }

  const result = [];

  while (number > 0n) {
    result.unshift(Number(number & 255n));
    number >>= 8n;
  }

  for (const char of value) {
    if (char !== "1") break;
    result.unshift(0);
  }

  return Uint8Array.from(result);
}

function equalBytes(a, b) {
  if (
    !(a instanceof Uint8Array) ||
    !(b instanceof Uint8Array) ||
    a.length !== b.length
  ) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return new Uint8Array(digest);
}

export async function sha256Hex(value) {
  if (typeof value !== "string") {
    throw new Error("Expected a string");
  }

  return bytesToHex(
    await sha256(encoder.encode(value))
  );
}

export function createAdminChallenge() {
  const nonce = crypto.randomUUID();

  const expiresAt = new Date(
    Date.now() + ADMIN_CHALLENGE_TTL_MS
  ).toISOString();

  const message = [
    "Hive Census administrator authentication",
    `Account: ${ADMIN_ACCOUNT}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`
  ].join("\n");

  return {
    account: ADMIN_ACCOUNT,
    nonce,
    expires_at: expiresAt,
    message
  };
}

export function validateAdminChallenge(
  challenge,
  expectedNonce
) {
  if (
    !challenge ||
    challenge.account !== ADMIN_ACCOUNT ||
    challenge.nonce !== expectedNonce ||
    typeof challenge.message !== "string" ||
    typeof challenge.expires_at !== "string"
  ) {
    return false;
  }

  const expiration = Date.parse(
    challenge.expires_at
  );

  if (
    !Number.isFinite(expiration) ||
    Date.now() >= expiration
  ) {
    return false;
  }

  const expectedMessage = [
    "Hive Census administrator authentication",
    `Account: ${ADMIN_ACCOUNT}`,
    `Nonce: ${challenge.nonce}`,
    `Expires: ${challenge.expires_at}`
  ].join("\n");

  return challenge.message === expectedMessage;
}

/*
 * Hive public keys use a textual prefix,
 * followed by Base58-encoded key material
 * and a four-byte checksum.
 *
 * The first 33 decoded bytes contain the
 * compressed secp256k1 public key.
 *
 * This function is used only for comparing
 * keys obtained from trusted Hive RPC data.
 */

export function hivePublicKeyBytes(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("STM")
  ) {
    throw new Error("Unsupported Hive public key");
  }

  const decoded = base58Decode(value.slice(3));

  if (decoded.length !== 37) {
    throw new Error("Invalid Hive public key length");
  }

  const publicKey = decoded.slice(0, 33);

  if (
    publicKey[0] !== 2 &&
    publicKey[0] !== 3
  ) {
    throw new Error("Invalid compressed public key");
  }

  secp256k1.ProjectivePoint.fromHex(publicKey);

  return publicKey;
}

/*
 * Hive Keychain requestSignBuffer returns
 * a 65-byte recoverable compact signature.
 *
 * Byte 0 is the recovery header.
 * Bytes 1–64 contain compact ECDSA r and s.
 *
 * The signed message is SHA-256 hashed
 * before signature verification.
 */

export async function recoverHiveSigningKey(
  message,
  signatureHex
) {
  if (
    typeof message !== "string" ||
    !message.length
  ) {
    throw new Error("Invalid signed message");
  }

  const signature = hexToBytes(signatureHex);

  if (signature.length !== 65) {
    throw new Error("Invalid Hive signature length");
  }

  const header = signature[0];

  if (header < 31 || header > 34) {
    throw new Error("Invalid Hive signature header");
  }

  const recovery = header - 31;

  const messageHash = await sha256(
    encoder.encode(message)
  );

  const compact = signature.slice(1);

  const parsed = secp256k1.Signature
    .fromCompact(compact)
    .addRecoveryBit(recovery);

  const recovered = parsed
    .recoverPublicKey(messageHash)
    .toRawBytes(true);

  const valid = secp256k1.verify(
    compact,
    messageHash,
    recovered,
    { lowS: false }
  );

  if (!valid) {
    throw new Error("Invalid Hive signature");
  }

  return recovered;
}

/*
 * Check whether the recovered signing key
 * is sufficient for the administrator's
 * posting authority.
 *
 * Direct key authorities are supported.
 * Account-delegated and multisignature
 * authorities are intentionally rejected.
 */

export function verifyAdminPostingAuthority(
  accountData,
  recoveredPublicKey
) {
  if (
    !accountData ||
    accountData.name !== ADMIN_ACCOUNT ||
    !accountData.posting ||
    !Array.isArray(accountData.posting.key_auths)
  ) {
    return false;
  }

  const posting = accountData.posting;

  const threshold = Number(
    posting.weight_threshold
  );

  if (
    !Number.isSafeInteger(threshold) ||
    threshold <= 0
  ) {
    return false;
  }

  for (const entry of posting.key_auths) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2
    ) {
      continue;
    }

    const [key, rawWeight] = entry;
    const weight = Number(rawWeight);

    if (
      !Number.isSafeInteger(weight) ||
      weight < threshold
    ) {
      continue;
    }

    try {
      const authorityKey = hivePublicKeyBytes(key);

      if (
        equalBytes(
          authorityKey,
          recoveredPublicKey
        )
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/*
 * Full signature verification.
 *
 * accountData must be fetched by the
 * Worker from a trusted Hive RPC node.
 * It must never come from the browser.
 */

export async function verifyAdminSignature(
  challenge,
  signatureHex,
  accountData
) {
  if (
    !challenge ||
    !validateAdminChallenge(
      challenge,
      challenge.nonce
    )
  ) {
    return false;
  }

  try {
    const publicKey = await recoverHiveSigningKey(
      challenge.message,
      signatureHex
    );

    return verifyAdminPostingAuthority(
      accountData,
      publicKey
    );
  } catch {
    return false;
  }
}

/*
 * Session token helpers.
 *
 * Store only SHA-256(token) in D1.
 * Send the raw token to the browser
 * in an HttpOnly cookie.
 */

export function createAdminSessionToken() {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return bytesToHex(bytes);
}

export async function hashAdminSessionToken(token) {
  if (
    typeof token !== "string" ||
    !/^[0-9a-f]{64}$/.test(token)
  ) {
    throw new Error("Invalid session token");
  }

  return sha256Hex(token);
}

export function createAdminSessionCookie(token) {
  if (
    typeof token !== "string" ||
    !/^[0-9a-f]{64}$/.test(token)
  ) {
    throw new Error("Invalid session token");
  }

  const maxAge = Math.floor(
    ADMIN_SESSION_TTL_MS / 1000
  );

  return [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export function clearAdminSessionCookie() {
  return [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}

export function readAdminSessionCookie(request) {
  const header = request.headers.get("Cookie") || "";

  const cookies = header.split(";");

  for (const item of cookies) {
    const separator = item.indexOf("=");

    if (separator < 0) continue;

    const name = item.slice(
      0,
      separator
    ).trim();

    if (name !== ADMIN_SESSION_COOKIE) {
      continue;
    }

    const token = item.slice(
      separator + 1
    ).trim();

    if (/^[0-9a-f]{64}$/.test(token)) {
      return token;
    }

    return null;
  }

  return null;
}

export function adminSessionExpiresAt() {
  return new Date(
    Date.now() + ADMIN_SESSION_TTL_MS
  ).toISOString();
}
