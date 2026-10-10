
import { secp256k1 } from "@noble/curves/secp256k1";

export const ADMIN_ACCOUNT = "jocieprosza";

export const ADMIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const HEX_PATTERN = /^[0-9a-fA-F]+$/;

function hexToBytes(hex) {
  if (
    typeof hex !== "string" ||
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

export function createAdminChallenge() {
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + ADMIN_CHALLENGE_TTL_MS
  ).toISOString();

  return {
    account: ADMIN_ACCOUNT,
    nonce,
    expires_at: expiresAt,
    message: [
      "Hive Census administrator authentication",
      `Account: ${ADMIN_ACCOUNT}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt}`
    ].join("\n")
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
    typeof challenge.message !== "string"
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

export function verifySecp256k1Signature(
  messageHashHex,
  signatureHex,
  publicKeyHex
) {
  try {
    const messageHash = hexToBytes(messageHashHex);
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);

    if (
      messageHash.length !== 32 ||
      signature.length !== 64 ||
      ![33, 65].includes(publicKey.length)
    ) {
      return false;
    }

    return secp256k1.verify(
      signature,
      messageHash,
      publicKey,
      { lowS: false }
    );
  } catch {
    return false;
  }
}
