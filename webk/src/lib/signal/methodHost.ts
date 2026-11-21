/*
 * TeleSignal: what the Signal method handlers of Web K (`chatMethods.ts`, `groupMethods.ts`) need from the adapter
 * (`appSignalManager.ts`): the provider's calls, the updates it pushes and the managers of Web K that hold the
 * chats and users. The adapter builds one host and passes it to every handler set.
 */

import type {
  AppChatsManager
} from '@appManagers/appChatsManager';
import type {AppMessagesManager} from '@appManagers/appMessagesManager';
import type {AppPeersManager} from '@appManagers/appPeersManager';
import type {AppUsersManager} from '@appManagers/appUsersManager';
import type {ApiUpdatesManager} from '@appManagers/apiUpdatesManager';
import type {Chat, InputPeer, MethodDeclMap, Update, User} from '@layer';
import {toSignalPeerId} from '@lib/signal/builders';

export type SignalMethodHandler = (params: any) => any;
export type SignalMethodHandlers = Partial<Record<keyof MethodDeclMap, SignalMethodHandler>>;

export type SignalMethodManagers = {
  appChatsManager: AppChatsManager,
  appMessagesManager: AppMessagesManager,
  appPeersManager: AppPeersManager,
  appUsersManager: AppUsersManager,
  apiUpdatesManager: ApiUpdatesManager
};

export type SignalMethodHost = {
  /** Calls a method of the provider (`src/api/signal/methods`) */
  call: <T = any>(name: string, ...args: any[]) => Promise<T>;
  /** The Web K peer id of an input peer, as the adapter reads it */
  getInputPeerId: (inputPeer: InputPeer) => PeerId | undefined;
  pushUpdates: (updates: Update[], users?: User[], chats?: Chat[]) => void;
  getManagers: () => SignalMethodManagers;
};

// The Telegram inputs that wrap a peer: `inputDialogPeer`, `inputNotifyPeer` and `inputFolderPeer`
const WRAPPED_PEER_TYPES = new Set(['inputDialogPeer', 'inputNotifyPeer', 'inputFolderPeer']);

/** The peer of an input that may wrap one (a dialog, notification or folder peer) */
export function unwrapInputPeer(input: any): InputPeer {
  return WRAPPED_PEER_TYPES.has(input?._) ? input.peer : input;
}

/** The Web K peer id of an input user, `inputUserSelf` being us */
export function getInputUserPeerId(host: SignalMethodHost, inputUser: any): PeerId | undefined {
  if(inputUser?._ === 'inputUserSelf') return host.getManagers().appPeersManager.peerId;
  return inputUser?._ === 'inputUser' ? +inputUser.user_id as PeerId : undefined;
}

/** The provider's user ref of a Web K peer id */
export function getUserRef(peerId: PeerId) {
  return {id: toSignalPeerId(peerId)};
}
