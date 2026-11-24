/*
 * TeleSignal: Signal's notification profiles on Web K's page. The engine keeps them (`src/api/signal/methods/
 * notificationProfiles.ts`) and says which one is on (`signal_notification_profiles`); while one is on, only its chats
 * notify, and mentions of us and replies to our messages when it allows them all, as Web A's
 * `selectIsMessageSilencedByNotificationProfile` decides (Signal Desktop `shouldNotify`).
 */

import type {MyMessage} from '@appManagers/appMessagesManager';
import type {AppManagers} from '@lib/managers';
import rootScope from '@lib/rootScope';
import {toSignalPeerId} from '@lib/signal/builders';
import {callSignalApi} from '@lib/signal/settingsApi';

/** A profile, with Web A's peer ids of its chats */
export type SignalNotificationProfile = {
  id: string,
  name: string,
  emoji?: string,
  // * 0xAARRGGBB
  color: number,
  allowedChatIds: string[],
  areAllCallsAllowed: boolean,
  areAllMentionsAllowed: boolean,
  isScheduleEnabled: boolean,
  // * hours and minutes as a number: 930 is 09:30
  scheduleStartTime?: number,
  scheduleEndTime?: number,
  // * 1 is Monday and 7 is Sunday
  scheduleDays: number[]
};

export type SignalNotificationProfilesState = {
  profiles: SignalNotificationProfile[],
  activeProfileId?: string,
  // * seconds: when the profile that is on turns off, or the next one turns on
  nextChangeAt?: number,
  isManuallyEnabled?: boolean,
  isManuallyDisabled?: boolean,
  overrideEndsAt?: number,
  // * profiles are kept on the primary device only, unless its user syncs them
  isSyncDisabled?: boolean
};

export type SignalNotificationProfileDraft = Omit<SignalNotificationProfile, 'id'> & {id?: string};

let state: SignalNotificationProfilesState;
let loading: Promise<SignalNotificationProfilesState>;

rootScope.addEventListener('signal_notification_profiles', (value) => state = value);

export function fetchNotificationProfiles() {
  return loading ??= callSignalApi<SignalNotificationProfilesState>('fetchNotificationProfiles').then((value) => {
    state ??= value;
    return state;
  }).finally(() => loading = undefined);
}

export async function saveNotificationProfile(profile: SignalNotificationProfileDraft) {
  return state = await callSignalApi('saveNotificationProfile', {profile});
}

export async function deleteNotificationProfile(id: string) {
  return state = await callSignalApi('deleteNotificationProfile', {id});
}

/** Turns a profile on by hand, until `endsAt` (seconds) if given; without an id turns profiles off by hand */
export async function setNotificationProfileActive(id?: string, endsAt?: number) {
  return state = await callSignalApi('setNotificationProfileActive', {id, endsAt});
}

/** Whether the profile that is on keeps a message from notifying */
export async function getIsSilencedByNotificationProfile(managers: AppManagers, message: MyMessage) {
  const {profiles, activeProfileId} = state ?? await fetchNotificationProfiles().catch((): undefined => undefined) ?? {};
  const profile = activeProfileId && profiles?.find(({id}) => id === activeProfileId);
  if(!profile || profile.allowedChatIds.includes(toSignalPeerId(message.peerId))) return false;
  if(!profile.areAllMentionsAllowed) return true;
  if(message.pFlags.mentioned) return false;

  const replyToMid = message.reply_to?._ === 'messageReplyHeader' ? message.reply_to.reply_to_msg_id : undefined;
  const replied = replyToMid && await managers.appMessagesManager.getMessageByPeer(message.peerId, replyToMid);
  return !replied?.pFlags.out;
}
