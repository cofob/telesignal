/*
 * TeleSignal: the Signal provider's methods that Web K's settings screens call. The engine runs in the worker, so the
 * screens reach it through `appSignalManager`; the results are typed here for the screens that read them, since the
 * provider's types stay out of this tree (`signalApi.d.ts`).
 */

import type {SignalMethodName} from '@lib/signal/signalApi';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import {buildNotifySettings} from '@lib/signal/accountMethods';

export type SignalDevice = {
  id: number,
  name?: string,
  lastSeen: number
};

export type SignalDevices = {
  isPrimary: boolean,
  currentDeviceId: number,
  devices: SignalDevice[]
};

export type SignalMessageSettings = {
  isReadReceiptsEnabled: boolean,
  isTypingIndicatorsEnabled: boolean,
  isLinkPreviewsEnabled: boolean,
  isSealedSenderIndicatorsEnabled: boolean
};

export type SignalPinSettings = {
  hasPin: boolean,
  isRegistrationLockEnabled?: boolean,
  [key: string]: unknown
};

/** Who sees our number and who can find us by it: `everybody` or `nobody`, as the provider has only those two */
export type SignalPhoneNumberPrivacy = {
  phoneNumber: {visibility: 'everybody' | 'nobody'},
  addByPhone: {visibility: 'everybody' | 'nobody'}
};

export type SignalNotifyDefaults = {
  users: SignalNotifyDefault,
  groups: SignalNotifyDefault
};

export type SignalNotifyDefault = {
  mutedUntil?: number,
  hasSound?: boolean,
  shouldShowPreviews?: boolean
};

export type SignalBlockedUsers = {
  blockedIds: string[],
  totalCount: number
};

export type SignalUsernameResult = {
  username?: string,
  error?: string
};

export type SignalDeviceLinkResult = {
  device?: SignalDevice,
  isPending?: true,
  error?: string
};

/**
 * A call of a provider method on the engine, which runs in the worker: the screens of this tab call it through the
 * Signal manager. A method the engine does not implement resolves with `undefined`.
 */
export function callSignalApi<T = any>(name: SignalMethodName, ...args: any[]): Promise<T> {
  return rootScope.managers.appSignalManager.callSignal(name, ...args);
}

export function fetchLinkedDevices(): Promise<SignalDevices | undefined> {
  return callSignalApi('fetchSignalDevices');
}

export function fetchIsPrimaryDevice(): Promise<boolean | undefined> {
  return callSignalApi('fetchIsSignalPrimary');
}

export function linkDevice(url: string): Promise<SignalDeviceLinkResult | undefined> {
  return callSignalApi('linkSignalDevice', url);
}

export function unlinkDevice(deviceId: number): Promise<true | undefined> {
  return callSignalApi('unlinkSignalDevice', deviceId);
}

export function fetchMessageSettings(): Promise<SignalMessageSettings | undefined> {
  return callSignalApi('fetchSignalMessageSettings');
}

export function updateMessageSettings(update: Partial<SignalMessageSettings>): Promise<SignalMessageSettings | undefined> {
  return callSignalApi('updateSignalMessageSettings', update);
}

export function fetchBlocked(): Promise<SignalBlockedUsers | undefined> {
  return callSignalApi('fetchBlockedUsers', {});
}

/** The provider looks the peer up by its id, which is the one `fetchBlocked` returns */
export function unblockPeer(peerId: string): Promise<true | undefined> {
  return callSignalApi('unblockUser', {user: {id: peerId}});
}

export function fetchPinSettings(): Promise<SignalPinSettings | undefined> {
  return callSignalApi('fetchSignalPinSettings');
}

export function setPin(pin: string): Promise<unknown> {
  return callSignalApi('setSignalPin', pin);
}

export function removePin(): Promise<unknown> {
  return callSignalApi('removeSignalPin');
}

export function setRegistrationLock(isEnabled: boolean): Promise<unknown> {
  return callSignalApi('setSignalRegistrationLock', isEnabled);
}

export function fetchContactDiscovery(): Promise<boolean | undefined> {
  return callSignalApi('fetchSignalContactDiscovery');
}

export function setContactDiscovery(isEnabled: boolean): Promise<unknown> {
  return callSignalApi('setSignalContactDiscovery', isEnabled);
}

export function fetchPhoneNumberPrivacy(): Promise<SignalPhoneNumberPrivacy | undefined> {
  return callSignalApi('fetchPhoneNumberPrivacy');
}

export function updatePhoneNumberPrivacy(update: {isShared?: boolean, isDiscoverable?: boolean}): Promise<SignalPhoneNumberPrivacy | undefined> {
  return callSignalApi('updatePhoneNumberPrivacy', update);
}

export function fetchNotifyDefaults(): Promise<SignalNotifyDefaults | undefined> {
  return callSignalApi('fetchNotifyDefaultSettings');
}

/** Saves a default, and hands it to the notifications of Web K (`appNotificationsManager`), which follow it at once */
export async function updateNotifyDefault(peerType: 'users' | 'groups', update: {isMuted?: boolean, shouldShowPreviews?: boolean}): Promise<unknown> {
  const managers = bindManagersToSession(rootScope.managers);
  const saved = await managers.appSignalManager.callSignal('updateNotificationSettings', peerType, update);
  if(!saved) return saved;

  const defaults: SignalNotifyDefaults = await managers.appSignalManager.callSignal('fetchNotifyDefaultSettings');
  const settings = buildNotifySettings(defaults?.[peerType]);
  const inputKeys = peerType === 'users' ? ['inputNotifyUsers' as const] : ['inputNotifyChats' as const, 'inputNotifyBroadcasts' as const];
  inputKeys.forEach((inputKey) => {
    managers.appNotificationsManager.generateLocalNotifySettingsUpdate({_: inputKey}, {
      _: 'inputPeerNotifySettings',
      show_previews: settings.show_previews,
      mute_until: settings.mute_until
    });
  });

  return saved;
}

export function fetchUsernameLink(): Promise<string | undefined> {
  return callSignalApi('fetchUsernameLink');
}

export function resetUsernameLink(): Promise<string | undefined> {
  return callSignalApi('resetUsernameLink');
}

export function reserveUsername(nickname: string, discriminator?: string): Promise<SignalUsernameResult | undefined> {
  return callSignalApi('reserveUsername', {nickname, discriminator});
}

export function confirmUsername(username: string): Promise<SignalUsernameResult | undefined> {
  return callSignalApi('confirmUsername', {username});
}

export function deleteUsername(): Promise<true | undefined> {
  return callSignalApi('deleteUsername');
}

export function updateProfile(params: {
  firstName: string,
  lastName?: string,
  bio?: string,
  photo?: File,
  shouldRemovePhoto?: true
}): Promise<true | undefined> {
  return callSignalApi('updateOwnProfile', params);
}

/* ---------- backups and the recovery key (`src/api/signal/methods/backups.ts`, `profile.ts`) ---------- */

export type SignalBackupFrequency = 'daily' | 'weekly' | 'monthly' | 'manual';

export type SignalBackupSettings = {
  unavailableReason?: 'noRecoveryKey' | 'noMediaRootKey',
  isPrimary: boolean,
  isEnabled: boolean,
  frequency: SignalBackupFrequency,
  lastBackupAt?: number,
  lastBackupSize?: number,
  tier?: number,
  lastError?: string,
  isRunning?: boolean,
  progress?: {step: 'exporting' | 'validating' | 'uploading', progress?: number}
};

export type SignalBackupRemoteStatus = {
  hasBackup: boolean,
  size?: number,
  modifiedAt?: number,
  tier?: number
};

/** The settings after an action of the backup settings, or the reason that it failed */
export type SignalBackupResult = SignalBackupSettings | {error: string};

export function fetchBackupSettings(): Promise<SignalBackupSettings | undefined> {
  return callSignalApi('fetchBackupSettings');
}

export function fetchBackupRemoteStatus(): Promise<SignalBackupRemoteStatus | undefined> {
  return callSignalApi('fetchBackupRemoteStatus');
}

export function enableBackups(frequency: SignalBackupFrequency, shouldReplaceBackup?: boolean): Promise<SignalBackupResult> {
  return callSignalApi('enableBackups', frequency, shouldReplaceBackup);
}

export function disableBackups(shouldDeleteBackup?: boolean): Promise<SignalBackupResult> {
  return callSignalApi('disableBackups', shouldDeleteBackup);
}

export function setBackupFrequency(frequency: SignalBackupFrequency): Promise<SignalBackupResult> {
  return callSignalApi('setBackupFrequency', frequency);
}

export function backUpNow(): Promise<SignalBackupResult> {
  return callSignalApi('backUpNow');
}

export function cancelBackup(): Promise<unknown> {
  return callSignalApi('cancelBackup');
}

export function exportBackupFile(): Promise<{fileName: string, data: Uint8Array} | {error: string}> {
  return callSignalApi('exportBackupFile');
}

export function importBackupFile(data: Uint8Array, recoveryKey: string): Promise<{messageCount: number} | {error: string}> {
  return callSignalApi('importBackupFile', data, recoveryKey);
}

/** The recovery key of a primary device, and whether the user has not confirmed saving it yet */
export function fetchRecoveryKey(): Promise<{key: string, isUnconfirmed?: boolean} | undefined> {
  return callSignalApi('fetchRecoveryKey');
}

export function confirmRecoveryKeySaved(): Promise<unknown> {
  return callSignalApi('confirmRecoveryKeySaved');
}

/* ---------- key transparency and story settings (`keyTransparency.ts`, `stories.ts`) ---------- */

export type SignalKeyTransparencySelfStatus = 'idle' | 'running' | 'ok' | 'fail' | 'intermittent';

export type SignalStorySettings = {
  areStoriesDisabled?: boolean,
  areViewReceiptsEnabled?: boolean
};

/** The result of the last check of our own account against the key log; none where the check is not available */
export function fetchKeyTransparencySelfStatus(): Promise<SignalKeyTransparencySelfStatus | undefined> {
  return callSignalApi('fetchKeyTransparencySelfStatus');
}

export function checkKeyTransparencySelf(): Promise<SignalKeyTransparencySelfStatus | undefined> {
  return callSignalApi('checkKeyTransparencySelf');
}

export function fetchStorySettings(): Promise<SignalStorySettings | undefined> {
  return callSignalApi('fetchStorySettings');
}

/** The settings after the change; `undefined` when it failed */
export function updateStorySettings(update: SignalStorySettings): Promise<SignalStorySettings | undefined> {
  return callSignalApi<SignalStorySettings>('updateStorySettings', update).catch((): undefined => undefined);
}
