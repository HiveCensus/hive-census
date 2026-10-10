
/*
 * Hive Census — HiveAuth integration
 * Version: 0.1.0
 *
 * Uses Aioha 1.8.5.
 * Does not modify the existing Keychain integration.
 */

import {
  initAioha,
  KeyTypes,
  Providers
} from "https://esm.sh/@aioha/aioha@1.8.5";

const CUSTOM_JSON_ID = "hive_census";

const aioha = initAioha({
  hiveauth: {
    name: "Hive Census",
    description:
      "Publish or remove your location declaration on Hive."
  }
});

let activeAccount = null;
let operationPending = false;

function normalizeAccount(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function validAccount(account) {
  return /^[a-z][a-z0-9.-]{2,15}$/.test(account);
}

function errorMessage(error) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error.message === "string") {
    return error.message;
  }

  return "Unknown HiveAuth error.";
}

/*
 * Login using HiveAuth.
 *
 * onRequest receives:
 *   payload — HiveAuth request data for QR/deep link
 *   cancel  — function to cancel the request
 *
 * The caller is responsible for displaying
 * the QR code or mobile link.
 */

export async function connectHiveAuth(
  accountName,
  onRequest
) {
  const account = normalizeAccount(accountName);

  if (!validAccount(account)) {
    throw new Error("Enter a valid Hive account.");
  }

  if (operationPending) {
    throw new Error(
      "Another HiveAuth operation is already in progress."
    );
  }

  operationPending = true;

  try {
    if (
      aioha.isLoggedIn() &&
      aioha.getCurrentProvider() === Providers.HiveAuth &&
      aioha.getCurrentUser() === account
    ) {
      activeAccount = account;

      return {
        success: true,
        account,
        reused: true
      };
    }

    if (aioha.isLoggedIn()) {
      await aioha.logout();
    }

    const result = await aioha.login(
      Providers.HiveAuth,
      account,
      {
        msg:
          "Connect to Hive Census: " +
          crypto.randomUUID(),

        keyType: KeyTypes.Posting,

        hiveauth: {
          cbWait: (payload, event, cancel) => {
            if (typeof onRequest === "function") {
              onRequest({
                payload,
                event,
                cancel
              });
            }
          }
        }
      }
    );

    if (!result || !result.success) {
      throw new Error(
        result?.error || "HiveAuth login failed."
      );
    }

    if (
      normalizeAccount(result.username) !== account
    ) {
      await aioha.logout();

      throw new Error(
        "Authenticated Hive account does not match."
      );
    }

    activeAccount = account;

    return {
      success: true,
      account,
      reused: false
    };
  } finally {
    operationPending = false;
  }
}

/*
 * Publish an existing Census payload.
 *
 * Supported actions:
 *   set
 *   unset
 */

export async function publishHiveAuth(
  accountName,
  payload
) {
  const account = normalizeAccount(accountName);

  if (!validAccount(account)) {
    throw new Error("Invalid Hive account.");
  }

  if (
    !payload ||
    payload.v !== 1 ||
    !["set", "unset"].includes(payload.action)
  ) {
    throw new Error("Invalid Census payload.");
  }

  if (
    !aioha.isLoggedIn() ||
    aioha.getCurrentProvider() !== Providers.HiveAuth ||
    aioha.getCurrentUser() !== account ||
    activeAccount !== account
  ) {
    throw new Error(
      "Connect the specified account with HiveAuth first."
    );
  }

  if (operationPending) {
    throw new Error(
      "Another HiveAuth operation is already in progress."
    );
  }

  operationPending = true;

  try {
    const title =
      payload.action === "unset"
        ? "Leave Hive Census"
        : "Publish Hive Census location";

    const result = await aioha.customJSON(
      KeyTypes.Posting,
      CUSTOM_JSON_ID,
      payload,
      title
    );

    if (!result || !result.success) {
      throw new Error(
        result?.error || "HiveAuth publishing failed."
      );
    }

    return {
      success: true,
      account,
      action: payload.action,
      transactionId: result.result || null
    };
  } finally {
    operationPending = false;
  }
}

export function getHiveAuthState() {
  return {
    connected:
      aioha.isLoggedIn() &&
      aioha.getCurrentProvider() === Providers.HiveAuth,

    account:
      aioha.getCurrentProvider() === Providers.HiveAuth
        ? aioha.getCurrentUser()
        : null,

    pending: operationPending
  };
}

export async function disconnectHiveAuth() {
  if (operationPending) {
    throw new Error(
      "Cannot disconnect during an active operation."
    );
  }

  await aioha.logout();
  activeAccount = null;

  return { success: true };
}

export function describeHiveAuthError(error) {
  return errorMessage(error);
}
