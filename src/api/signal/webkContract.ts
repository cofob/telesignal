/*
 * Web K's description of this provider (`webk/src/lib/signal/signalApi.d.ts`) checked against the provider itself.
 * Web K's type check cannot include the provider's sources, so it types the calls and the `Api*` fields it reads by
 * hand; this file makes `npm run check:ts` fail when a method that Web K calls is gone or an object that the provider
 * hands to Web K, or takes from it, no longer has the shape that Web K expects. It holds types only.
 */

import type * as webKKeyboardShortcuts from '../../../webk/src/lib/signal/keyboardShortcutsApi';
import type * as webKKeyCombos from '../../../webk/src/lib/signal/keyCombosApi';
import type {
  SignalAdminRights, SignalAttachment, SignalAudio, SignalBannedRights, SignalChat, SignalContact, SignalDocument,
  SignalInitialArgs, SignalMessage, SignalMethodName, SignalPhoto, SignalReadState, SignalSticker, SignalStickerSet,
  SignalUser, SignalVideo, SignalVoice, SignalWebPage,
} from '../../../webk/src/lib/signal/signalApi';
import type { ThreadReadState } from '../../types';
import type * as keyCombos from '../../util/keyboardShortcuts/keyCombos';
import type * as keyboardShortcuts from '../../util/keyboardShortcuts/registry';
import type {
  ApiAttachment, ApiAudio, ApiChat, ApiChatAdminRights, ApiChatBannedRights, ApiContact, ApiDocument, ApiInitialArgs,
  ApiMessage, ApiPhoto, ApiSticker, ApiStickerSet, ApiUser, ApiVideo, ApiVoice, ApiWebPageFull,
} from '../types';
import type { ApiMessageAction } from '../types/messageActions';
import type * as methods from './methods';

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type WithoutAction<T extends { content: object }> = Omit<T, 'content'> & { content: Omit<T['content'], 'action'> };

// The action types whose fields `webk/src/lib/signal/builders.ts` reads by name
type WebKActionType = 'chatAddUser' | 'chatCreate' | 'chatDeleteUser' | 'chatEditTitle' | 'chatJoinedByLink'
  | 'chatJoinedByRequest' | 'deleted' | 'giftBadge' | 'groupUpdate' | 'payment' | 'pinMessage' | 'safetyNumberChange'
  | 'safetyNumberVerified' | 'setMessagesTtl' | 'signalCall' | 'viewOnce';

// Every method that Web K calls is one of the provider's
export type WebKMethods = Assert<Extends<SignalMethodName, keyof typeof methods>>;

// What the provider hands to Web K has the fields that Web K reads; an action is checked by its type below
export type WebKUser = Assert<Extends<ApiUser, SignalUser>>;
export type WebKChat = Assert<Extends<ApiChat, SignalChat>>;
export type WebKMessage = Assert<Extends<WithoutAction<ApiMessage>, SignalMessage>>;
export type WebKPhoto = Assert<Extends<ApiPhoto, SignalPhoto>>;
export type WebKVideo = Assert<Extends<ApiVideo, SignalVideo>>;
export type WebKDocument = Assert<Extends<ApiDocument, SignalDocument>>;
export type WebKAudio = Assert<Extends<ApiAudio, SignalAudio>>;
export type WebKVoice = Assert<Extends<ApiVoice, SignalVoice>>;
export type WebKSticker = Assert<Extends<ApiSticker, SignalSticker>>;
export type WebKStickerSet = Assert<Extends<ApiStickerSet, SignalStickerSet>>;
export type WebKWebPage = Assert<Extends<ApiWebPageFull, SignalWebPage>>;
export type WebKReadState = Assert<Extends<ThreadReadState, SignalReadState>>;
export type WebKAdminRights = Assert<Extends<keyof SignalAdminRights, keyof ApiChatAdminRights>>;
export type WebKBannedRights = Assert<Extends<keyof SignalBannedRights, keyof ApiChatBannedRights>>;
export type WebKActionTypes = Assert<Extends<WebKActionType, ApiMessageAction['type']>>;

// What Web K hands to the provider has the fields that the provider reads
export type WebKAttachment = Assert<Extends<SignalAttachment, ApiAttachment>>;
export type WebKContact = Assert<Extends<SignalContact, ApiContact>>;
export type WebKInitialArgs = Assert<Extends<SignalInitialArgs, ApiInitialArgs>>;

// The keyboard shortcuts that Web K takes from Web A (`@signal-app/keyboard-shortcuts`, `@signal-app/key-combos`) are as
// Web K describes them, with the same ids both ways
type WebKShortcutId = webKKeyboardShortcuts.KeyboardShortcutId;
export type WebKKeyboardShortcutIds = Assert<Extends<keyboardShortcuts.KeyboardShortcutId, WebKShortcutId>>;
export type WebAKeyboardShortcutIds = Assert<Extends<WebKShortcutId, keyboardShortcuts.KeyboardShortcutId>>;
export type WebKKeyboardShortcuts = Assert<Extends<
  Pick<typeof keyboardShortcuts, keyof typeof webKKeyboardShortcuts>, typeof webKKeyboardShortcuts
>>;
// The labels read only the names of keys from the translation function, which Web K passes as a plain function
type KeyLabelFunctions = 'getKeyComboLabels' | 'getKeyComboText' | 'getKeyLabel';
export type WebKKeyCombos = Assert<Extends<
  Pick<typeof keyCombos, Exclude<keyof typeof webKKeyCombos, KeyLabelFunctions>>,
  Omit<typeof webKKeyCombos, KeyLabelFunctions>
>>;
export type WebKKeyLabels = Assert<Extends<KeyLabelFunctions, keyof typeof keyCombos>>;
