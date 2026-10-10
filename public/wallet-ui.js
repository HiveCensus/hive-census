
/* Hive Census — wallet UI adapter v0.1.0
 * Loaded after /app.js and the existing inline menu adapter.
 */
import {
  connectHiveAuth,
  publishHiveAuth,
  getHiveAuthState,
  describeHiveAuthError
} from "/hiveauth.js";

const el = id => document.getElementById(id);
const modal = el("hiveAuthModal");
const modalStatus = el("hiveAuthModalStatus");
const qrTarget = el("hiveAuthQr");
const openLink = el("hiveAuthOpenLink");
const copyButton = el("hiveAuthCopyBtn");
const cancelButton = el("hiveAuthCancelBtn");
const closeButton = el("hiveAuthCloseBtn");
const status = el("status");
let mode = "keychain";
let pendingCancel = null;
let requestLink = null;
let activeOperation = false;
let qrSequence = 0;

function account() {
  return (el("account")?.value || "").trim().replace(/^@/, "").toLowerCase();
}
function validAccount(name) {
  return /^[a-z][a-z0-9.-]{2,15}$/.test(name);
}
function message(text, bad = false) {
  if (!status) return;
  status.textContent = text;
  status.style.color = bad ? "#ff7288" : "#9da8b4";
}
function setModal(open) {
  if (!modal) return;
  modal.hidden = !open;
  if (open) closeButton?.focus();
}
function dismissModal(cancel = false) {
  if (cancel && pendingCancel) {
    try { pendingCancel(); } catch (error) { console.warn(error); }
  }
  pendingCancel = null;
  requestLink = null;
  qrSequence++;
  setModal(false);
}
function resetRequest() {
  requestLink = null;
  pendingCancel = null;
  if (qrTarget) qrTarget.replaceChildren();
  if (openLink) openLink.hidden = true;
  if (copyButton) copyButton.disabled = true;
  if (modalStatus) modalStatus.textContent = "Waiting for a HiveAuth request…";
}
async function showRequest({ payload, cancel }) {
  pendingCancel = typeof cancel === "function" ? cancel : null;
  // Aioha provides the HiveAuth deep-link as the QR payload.
  if (typeof payload !== "string" || !payload.startsWith("has://")) {
    if (modalStatus) modalStatus.textContent = "Unsupported HiveAuth request format. Please cancel and retry.";
    return;
  }
  requestLink = payload;
  if (openLink) {
    openLink.href = payload;
    openLink.hidden = false;
  }
  if (copyButton) copyButton.disabled = false;
  if (modalStatus) modalStatus.textContent = "Scan this QR code with your HiveAuth-compatible wallet, or open the link on your phone.";
  const seq = ++qrSequence;
  try {
    // QR is generated locally in the browser; the session key is never sent to a QR service.
    const QRCode = await import("https://esm.sh/qrcode@1.5.4");
    if (seq !== qrSequence || !qrTarget) return;
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, payload, {
      width: 240,
      margin: 2,
      color: { dark: "#111111", light: "#ffffff" }
    });
    if (seq !== qrSequence) return;
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    qrTarget.replaceChildren(canvas);
  } catch (error) {
    console.error("HiveAuth QR generation failed", error);
    if (modalStatus) modalStatus.textContent = "QR code unavailable. Use Open in wallet or Copy link.";
  }
}
function selectMethod(next) {
  mode = next;
  el("walletOptions")?.setAttribute("hidden", "");
  el("connectBtn")?.setAttribute("aria-expanded", "false");
  const note = el("walletMethodNote");
  if (note) note.textContent = next === "hiveauth"
    ? "HiveAuth selected. Connect your account before publishing."
    : "Hive Keychain selected. Confirm the operation in your wallet when publishing.";
  const review = el("walletReviewNote");
  if (review) review.textContent = next === "hiveauth"
    ? "HiveAuth will request your approval before broadcasting the operation."
    : "Hive Keychain will show the operation for approval before publishing.";
  const formAuth = el("formHiveAuthBtn");
  const formKeychain = el("formKeychainBtn");
  formAuth?.setAttribute("aria-pressed", String(next === "hiveauth"));
  formKeychain?.setAttribute("aria-pressed", String(next === "keychain"));
}
async function connect() {
  const name = account();
  if (!validAccount(name)) {
    message("Enter a valid Hive username before connecting with HiveAuth.", true);
    el("account")?.focus();
    return false;
  }
  resetRequest();
  setModal(true);
  try {
    const result = await connectHiveAuth(name, showRequest);
    if (account() !== name) throw new Error("Hive username changed during authentication. Reconnect the wallet.");
    dismissModal(false);
    selectMethod("hiveauth");
    message(`HiveAuth connected: @${result.account}. You can now publish your Census declaration.`);
    return true;
  } catch (error) {
    dismissModal(false);
    message("HiveAuth connection failed: " + describeHiveAuthError(error), true);
    return false;
  }
}
async function chooseHiveAuth() {
  if (activeOperation) return;
  selectMethod("hiveauth");
  location.hash = "join";
  await connect();
}
function onAccountChanged() {
  if (mode === "hiveauth") {
    const state = getHiveAuthState();
    if (state.account !== account()) message("HiveAuth account changed. Connect again before publishing.");
  }
}
function attachPublish(buttonId, action) {
  const button = el(buttonId);
  if (!button) return;
  const keychainHandler = button.onclick;
  button.onclick = async event => {
    if (mode !== "hiveauth") {
      if (typeof keychainHandler === "function") return keychainHandler.call(button, event);
      return;
    }
    if (activeOperation) return;
    const name = account();
    if (!validAccount(name)) return message("Enter a valid Hive account.", true);
    if (action === "set") {
      if (!el("permanentAck")?.checked) return message("Confirm the permanent public record acknowledgement.", true);
      if (typeof censusPayload !== "function") return message("Census payload is unavailable.", true);
    } else if (typeof findCurrentDeclaration === "function" && !findCurrentDeclaration(name)) {
      return message("This account has no active Census declaration.", true);
    }
    const payload = action === "set"
      ? censusPayload()
      : { v: 1, action: "unset" };
    if (!payload) return message("Choose a locality first.", true);
    const state = getHiveAuthState();
    if (!state.connected || state.account !== name) {
      const connected = await connect();
      if (!connected) return;
    }
    if (account() !== name) return message("Hive username changed. Please retry.", true);
    activeOperation = true;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Waiting for HiveAuth…";
    message("Approve the Hive Census operation in your HiveAuth wallet…");
    try {
      const result = await publishHiveAuth(name, payload);
      if (result.success) {
        message(action === "set"
          ? "Census declaration published. The map will update after the indexer processes the new block."
          : "Unset published. The account will disappear after the indexer processes the new block.");
        if (action === "unset") el("leaveCensusConfirm")?.classList.add("hidden");
        if (typeof loadCensusMap === "function") setTimeout(loadCensusMap, 10000);
      }
    } catch (error) {
      message("HiveAuth publishing failed: " + describeHiveAuthError(error), true);
    } finally {
      activeOperation = false;
      button.textContent = oldText;
      if (action === "set" && typeof updatePublishButton === "function") updatePublishButton();
      else button.disabled = false;
    }
  };
}

// Buttons are activated only after this module has successfully loaded.
for (const id of ["walletHiveAuthBtn", "formHiveAuthBtn"]) {
  const button = el(id);
  if (!button) continue;
  button.disabled = false;
  button.removeAttribute("title");
  button.textContent = id === "walletHiveAuthBtn" ? "HiveAuth" : "Use HiveAuth";
  button.addEventListener("click", chooseHiveAuth);
}
el("walletKeychainBtn")?.addEventListener("click", () => selectMethod("keychain"));
el("formKeychainBtn")?.addEventListener("click", () => selectMethod("keychain"));
el("account")?.addEventListener("input", onAccountChanged);
copyButton?.addEventListener("click", async () => {
  if (!requestLink) return;
  try { await navigator.clipboard.writeText(requestLink); }
  catch { if (modalStatus) modalStatus.textContent = "Unable to copy. Use Open in wallet instead."; }
});
cancelButton?.addEventListener("click", () => dismissModal(true));
closeButton?.addEventListener("click", () => dismissModal(true));
modal?.addEventListener("click", event => {
  if (event.target === modal) dismissModal(true);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && modal && !modal.hidden) dismissModal(true);
});
attachPublish("publishBtn", "set");
attachPublish("publishUnsetBtn", "unset");
console.info("Hive Census wallet UI adapter loaded");
