import type { HistoryTransferProgress } from '../../lib/signal/backups/transferHistory';
import type { AccountRecord } from '../../lib/signal/store/SignalStore';
import type { ApiInitialArgs, ApiSessionData, ApiUpdateDeviceDeauthorized } from '../types';

import { DEBUG, IS_SIGNAL_BACKUPS_ENABLED } from '../../config';
import { checkAccountAuthorized, linkDevice, unlinkDevice } from '../../lib/signal/account/linkDevice';
import { startDeviceLink } from '../../lib/signal/account/provisioning';
import { resumePendingRegistration } from '../../lib/signal/account/register';
import { resetCdsiState } from '../../lib/signal/cdsi/cdsiLookup';
import {
  getSignalTunnelUrl, setSignalProxyUrl, setSignalSealedSenderProxyUrl, SIGNAL_PRIMARY_DEVICE_ID,
} from '../../lib/signal/config';
import { acquireEngineOwnership } from '../../lib/signal/engineOwnership';
import { closeIdleHttpConnections } from '../../lib/signal/net/http';
import { WebSocketConnectError } from '../../lib/signal/net/WebSocketClient';
import { sendInitialSyncRequests } from '../../lib/signal/sender/syncRequests';
import { isStorageKeyError, requireAtRestKey } from '../../lib/signal/store/atRest';
import { applyStorageKey, forgetStorageKey, reapplyStorageKey } from '../../lib/signal/store/atRestMigration';
import { holdEngineLock, releaseEngineLock } from '../../lib/signal/store/engineLock';
import { initSignalWasm } from '../../lib/signal/wasm';
import { ACCOUNT_SLOT } from '../../util/multiaccount';
import { pause } from '../../util/schedulers';
import { buildApiUser, buildApiUserFullInfo } from './builders/users';
import { clearAttachmentCache } from './media/attachments';
import {
  backups, client, db, keyTransparency, logError, processor, store,
} from './engine';
import { resetRegistration, resumeRegistration, startRegistration } from './registration';
import { sendApiUpdate } from './updates';

const DEVICE_NAME = 'TeleSignal';
const LINK_QR_LIFETIME_S = 60 * 60;
const LINK_RETRY_DELAY_MS = 3000;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60 * 1000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const PERCENT = 100;
// The error code of the dialog, see `READABLE_ERROR_KEYS` in `src/util/getReadableErrorText.ts`
const HISTORY_TRANSFER_FAILED_ERROR = 'SIGNAL_HISTORY_TRANSFER_FAILED';
const SIGNAL_SESSION_DATA: ApiSessionData = { isLinked: true };

let currentAccount: AccountRecord | undefined;
let initialArgs: ApiInitialArgs | undefined;
let reconnectDelay = RECONNECT_MIN_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let linkSession: Awaited<ReturnType<typeof startDeviceLink>> | undefined;
let isDestroyed = false;
let hasSyncedThisSession = false;
// Whether the session reached its first connection attempt, from which it stays connected until it stops
let isConnectionStarted = false;
let isConnecting = false;
// A reconnect that was asked for while a connection attempt was under way, which runs when the attempt ends
let isReconnectPending = false;
// Changes on every stop, so a device link loop of an earlier start ends instead of running beside a new one
let clientGeneration = 0;
let historyTransferController: AbortController | undefined;
// Why the server stopped accepting this device, until the link screen of the next start tells the user
let pendingDeauthorization: ApiUpdateDeviceDeauthorized['reason'] | undefined;

/**
 * Connects the stored account, or shows the link QR code until the phone scans it; registration with a phone
 * number starts from there. An account whose registration stopped before its profile resumes at that step, and so
 * does one that the server created while the app was closed before it saw the answer.
 * The app treats an account as authorized even while the connection is down, so local chats stay visible.
 */
export async function startClient(args: ApiInitialArgs) {
  isDestroyed = false;
  initialArgs = args;
  applyProxyUrls(args.signalProxyUrl, args.signalSealedSenderProxyUrl);
  // The other frontend shows its inactive screen once this one starts, see `listenOtherClients`
  await acquireEngineOwnership(() => void stopClient(false).catch(logError));
  holdEngineLock(ACCOUNT_SLOT || 1);
  try {
    await startEngine(args);
  } catch (err) {
    if (!isStorageKeyError(err)) throw err;
    // The data is encrypted and its key is missing or wrong. Nothing is wiped, since the key may be only late, such as
    // while another tab changes the passcode: the engine stops, and the page asks the user what to do
    logError(err);
    // A key that did not open the data must not encrypt new records either
    forgetStorageKey();
    requireAtRestKey();
    releaseEngineLock();
    sendApiUpdate({ '@type': 'updateStorageLocked' });
  }
}

async function startEngine(args: ApiInitialArgs) {
  await applyStorageKey(args.storageKey, store, db, logError);
  await initSignalWasm();
  sendApiUpdate({ '@type': 'updateApiReady' });

  const account = await readStoredAccount();
  if (account?.isRegistrationPending) {
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    resumeRegistration(account);
    return;
  }
  if (account) {
    await startSession(account);
    return;
  }
  // A registration that cannot be resumed yet keeps its keys, and with them the slot's data
  if (!await store.getItem('pendingRegistration')) {
    await discardOrphanedData();
    // Only here the engine knows that the storage was read and holds no account
    sendApiUpdate({ '@type': 'updateStaleSession' });
  }
  void runDeviceLink(args.platform).catch(logError);
}

/** The stored account, or one that a registration created; a record that the key does not open throws */
async function readStoredAccount() {
  return await store.getItem('account') ?? await resumeInterruptedRegistration();
}

/** The account that a registration created before the app stopped, when the server has it */
async function resumeInterruptedRegistration() {
  try {
    return await resumePendingRegistration(store);
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Leaves the link QR code for registration with a phone number */
export function switchToRegistration() {
  if (currentAccount) return;
  stopDeviceLink();
  startRegistration(initialArgs?.langCode);
}

/** Leaves registration for the link QR code */
export function switchToDeviceLink() {
  if (currentAccount) return;
  resetRegistration();
  stopDeviceLink();
  // The link screen shows a spinner until the provisioning socket sends the new code
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateWaitQrCode' });
  void runDeviceLink(initialArgs?.platform).catch(logError);
}

export function getCurrentAccount() {
  return currentAccount;
}

/** Closes the connections; `shouldForget` also removes the account, every local message and attachment */
export async function stopClient(shouldForget: boolean) {
  isDestroyed = true;
  isConnectionStarted = false;
  isReconnectPending = false;
  clientGeneration++;
  clearTimeout(reconnectTimer);
  linkSession?.cancel();
  resetRegistration();
  historyTransferController?.abort();
  releaseEngineLock();
  processor.stop();
  keyTransparency.stop();
  backups.stop();
  client.close();
  resetCdsiState();
  currentAccount = undefined;
  if (shouldForget) {
    await store.clear();
    await db.clear();
    await clearAttachmentCache();
    // A link that follows in this session stores its account encrypted too, with the key that the engine has now
    await reapplyStorageKey(store, db).catch(logError);
  }
}

function applyProxyUrls(proxyUrl: string | undefined, sealedSenderProxyUrl: string | undefined) {
  const prevTunnelUrls = [getSignalTunnelUrl('authenticated'), getSignalTunnelUrl('unauthenticated')];
  setSignalProxyUrl(proxyUrl);
  setSignalSealedSenderProxyUrl(sealedSenderProxyUrl);
  const tunnelUrls = [getSignalTunnelUrl('authenticated'), getSignalTunnelUrl('unauthenticated')];
  if (tunnelUrls.some((url, i) => url !== prevTunnelUrls[i])) closeIdleHttpConnections();
}

function stopDeviceLink() {
  clientGeneration++;
  linkSession?.cancel();
  linkSession = undefined;
}

async function runDeviceLink(platform?: string) {
  const generation = clientGeneration;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });

  while (generation === clientGeneration) {
    let session;
    try {
      session = await startDeviceLink();
    } catch (err) {
      logError(err);
      await pause(LINK_RETRY_DELAY_MS);
      continue;
    }
    if (generation !== clientGeneration) {
      session.cancel();
      return;
    }
    linkSession = session;

    // The app resets its state while it logs out, which can happen after the first update of this loop
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    sendApiUpdate({
      '@type': 'updateAuthorizationState',
      authorizationState: 'authorizationStateWaitQrCode',
      qrCode: { token: linkSession.url, expires: Math.floor(Date.now() / 1000) + LINK_QR_LIFETIME_S },
    });
    if (pendingDeauthorization) {
      sendApiUpdate({ '@type': 'updateDeviceDeauthorized', reason: pendingDeauthorization });
      pendingDeauthorization = undefined;
    }

    let message;
    try {
      message = await linkSession.provisionMessage;
    } catch {
      // The provisioning socket closed before a scan; show a new code
      continue;
    }

    const deviceName = platform ? `${DEVICE_NAME} (${platform})` : DEVICE_NAME;
    const account = await linkDevice(store, message, deviceName);
    await startSession(account);
    return;
  }
}

/** Shows the account's chats and connects it; registration calls it once the new account is complete */
export async function startSession(storedAccount: AccountRecord) {
  let account = storedAccount;
  currentAccount = account;
  let hasHistoryTransferFailed = false;
  if (account.historyTransfer && account.ephemeralBackupKey && !account.isDemo) {
    const outcome = await runHistoryTransfer();
    if (isDestroyed) return;
    if (outcome === 'relink') {
      await handleRelinkRequested(account);
      return;
    }
    hasHistoryTransferFailed = outcome === 'failed';
    // The import stores account settings from the primary device
    account = (await store.getItem('account'))!;
    currentAccount = account;
  }

  const self = await processor.getOrCreatePrivateConversation(account.aci);
  sendApiUpdate({
    '@type': 'updateCurrentUser',
    currentUser: buildApiUser(self, account.aci),
    currentUserFullInfo: buildApiUserFullInfo(self, account.aci),
  });
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateReady' });
  // The UI keeps its state and settings only for a stored session; the Signal account lives in the engine's own
  // store, so this session holds no keys and only marks the account slot as linked
  sendApiUpdate({ '@type': 'updateSession', sessionData: SIGNAL_SESSION_DATA });
  if (hasHistoryTransferFailed) {
    sendApiUpdate({ '@type': 'error', error: { message: HISTORY_TRANSFER_FAILED_ERROR, hasErrorKey: true } });
  }

  if (account.isDemo && DEBUG) {
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    return;
  }

  hasSyncedThisSession = false;
  isConnectionStarted = true;
  await connect();
}

/** Messages and attachments exist only together with an account, so any that remain without one belong to none */
async function discardOrphanedData() {
  try {
    await db.clear();
    await clearAttachmentCache();
    await store.removeItem('unlinkedAci');
  } catch (err) {
    logError(err);
  }
}

/**
 * Link and sync: keeps the link screen in its syncing state while the message history from the primary device
 * is transferred. A failed transfer leaves the account linked, without the history.
 */
async function runHistoryTransfer(): Promise<'done' | 'failed' | 'relink'> {
  const controller = new AbortController();
  historyTransferController = controller;
  let lastSent: HistoryTransferProgress | undefined;
  const sendProgress = (progress: HistoryTransferProgress) => {
    const historySync = {
      step: progress.step,
      progress: progress.progress === undefined ? undefined : Math.floor(progress.progress * PERCENT) / PERCENT,
    };
    if (lastSent?.step === historySync.step && lastSent.progress === historySync.progress) return;
    lastSent = historySync;
    sendApiUpdate({
      '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateWaitQrCode', historySync,
    });
  };

  try {
    sendProgress({ step: 'waiting' });
    const { transferHistory } = await import('../../lib/signal/backups/transferHistory');
    const outcome = await transferHistory(store, processor, sendProgress, controller.signal);
    // eslint-disable-next-line no-console
    console.info('[signal] Message history transfer', outcome);
    return outcome.type === 'relink' ? 'relink' : 'done';
  } catch (err) {
    if (!controller.signal.aborted) logError(err);
    return 'failed';
  } finally {
    historyTransferController = undefined;
  }
}

/**
 * The primary device could not export the history and asks to link again, which it tells the user: this device
 * leaves the account and shows a new code
 */
async function handleRelinkRequested(account: AccountRecord) {
  await unlinkDevice(account).catch(logError);
  await stopClient(true);
  isDestroyed = false;
  void runDeviceLink().catch(logError);
}

/**
 * Runs once per session after the first connection: the sync requests to the primary device until they
 * succeed once for the account, then our profile, a storage service sync and missing or stale contact profiles.
 * A failed step does not stop the others, and the next connection runs them all again.
 */
async function syncAfterConnect() {
  if (hasSyncedThisSession) return;
  hasSyncedThisSession = true;

  let isComplete = true;
  const runStep = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (err) {
      isComplete = false;
      logError(err);
    }
  };

  const context = client.getSenderContext();
  await runStep(async () => {
    if (context.account.isInitialSyncDone) return;
    await sendInitialSyncRequests(context);
    await client.updateAccount({ isInitialSyncDone: true });
  });
  void processor.refreshProfile(context.account.aci).catch(logError);
  await runStep(() => processor.syncStorage());
  void processor.refreshStaleProfiles().catch(logError);

  if (!isComplete) hasSyncedThisSession = false;
}

async function connect() {
  await attemptConnection();

  if (isReconnectPending) {
    isReconnectPending = false;
    reconnectClient();
  }
}

async function attemptConnection() {
  if (isDestroyed) return;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });

  isConnecting = true;
  try {
    await client.connect({
      onContent: (decrypted) => processor.processContent(decrypted),
      onClose: () => scheduleReconnect(),
      onError: logError,
    });
  } catch (err) {
    if (err instanceof WebSocketConnectError && (err.status === HTTP_UNAUTHORIZED || err.status === HTTP_FORBIDDEN)) {
      await handleUnauthorized();
      return;
    }
    logError(err);
    scheduleReconnect();
    return;
  } finally {
    isConnecting = false;
  }

  reconnectDelay = RECONNECT_MIN_DELAY_MS;
  processor.start();
  keyTransparency.start();
  void startBackupSchedule();
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
  syncAfterConnect().catch(logError);
}

/** Backups run while the app is open and connected, once the account has backups turned on */
async function startBackupSchedule() {
  const account = await store.getItem('account');
  if (IS_SIGNAL_BACKUPS_ENABLED && account?.backups?.isEnabled) backups.start();
}

/**
 * Replaces the chat connection at once, for the page to call after the computer slept or the network changed: the
 * old socket can look alive for up to the keepalive timeout, and after failed attempts the next one waits for the
 * backoff. An attempt that is already under way is left to finish, and the reconnect follows it.
 */
export function reconnectClient() {
  if (isDestroyed || !isConnectionStarted || currentAccount?.isDemo) return;
  if (isConnecting) {
    isReconnectPending = true;
    return;
  }

  void reconnect();
}

async function reconnect() {
  isConnecting = true;
  // The close reaches `scheduleReconnect`, whose timer the connection below makes unnecessary
  const drained = client.close();
  clearTimeout(reconnectTimer);
  // The new connection loads the envelopes that are stored but not processed, and the old one still processes them
  await drained;
  isConnecting = false;

  if (isDestroyed) return;
  reconnectDelay = RECONNECT_MIN_DELAY_MS;
  void connect();
}

function scheduleReconnect() {
  if (isDestroyed) return;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => void connect(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
}

/**
 * The chat socket refused our credentials. One authenticated request confirms it before anything is removed: a
 * request that fails otherwise, or one that the server accepts, leaves the account alone and tries again later.
 */
async function handleUnauthorized() {
  const account = currentAccount!;
  try {
    if (await checkAccountAuthorized(account)) {
      scheduleReconnect();
      return;
    }
  } catch (err) {
    logError(err);
    scheduleReconnect();
    return;
  }

  // The engine stopped, or started another account, while the server was asked
  if (isDestroyed || currentAccount !== account) return;
  await handleDeauthorized(account);
}

/** Why the server stopped accepting this device, while the link screen has not told it yet */
export function getPendingDeauthorization() {
  return pendingDeauthorization;
}

/**
 * The server no longer accepts this device: the phone unlinked it, another device removed it, or the number was
 * registered elsewhere. The account, keys, messages and attachments go at once, and the app logs out like the user's
 * logout does, which clears its own state and starts a new link; the link screen tells why.
 */
async function handleDeauthorized(account: AccountRecord) {
  pendingDeauthorization = account.deviceId === SIGNAL_PRIMARY_DEVICE_ID ? 'deregistered' : 'unlinked';
  try {
    await stopClient(true);
  } catch (err) {
    // The logout of the app wipes the data again
    logError(err);
  }
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateBroken' });
}
