import BackupService from '../../lib/signal/backups/BackupService';
import MessageDb from '../../lib/signal/db/MessageDb';
import GroupManager from '../../lib/signal/groups/GroupManager';
import KeyTransparency from '../../lib/signal/keytrans/KeyTransparency';
import MessageProcessor from '../../lib/signal/messages/MessageProcessor';
import { setServerTimeListener } from '../../lib/signal/net/http';
import { isPniServiceId } from '../../lib/signal/serviceId';
import SignalClient from '../../lib/signal/SignalClient';
import SignalStore from '../../lib/signal/store/SignalStore';
import { getLoggableError } from '../../util/maskSensitiveText';
import { forgetSharedMediaCounts } from './methods/messages';
import { handleBackupChange } from './updaters/backups';
import { handleCallChanges } from './updaters/calls';
import { handleChatChanges } from './updaters/chats';
import { handleMessageChanges, handleTyping } from './updaters/messages';
import { handleNotificationProfilesChange } from './updaters/notificationProfiles';
import { handleStickerPacksChange } from './updaters/stickers';
import { handleStoryChanges } from './updaters/stories';
import { sendApiUpdate } from './updates';

// The error code of the dialog, see `READABLE_ERROR_KEYS` in `src/util/getReadableErrorText.ts`
const KEY_TRANSPARENCY_FAILED_ERROR = 'SIGNAL_KEY_TRANSPARENCY_FAILED';

/** The Signal engine of this worker: protocol store, message database, connections and processing */
export const store = new SignalStore();
export const db = new MessageDb();
export const client = new SignalClient(store);
// Change batches reach the app in order, and each batch's messages before its chats: the app counts unread
// messages from `newMessage` updates, so a read state must not overtake the messages it covers
let updateChain = Promise.resolve();

export const processor = new MessageProcessor(db, client, {
  onChanges: (changes) => {
    forgetSharedMediaCounts(changes);
    updateChain = updateChain
      .then(() => handleMessageChanges(changes))
      .then(() => handleChatChanges(changes))
      .then(() => handleStoryChanges(changes))
      .then(() => handleCallChanges(changes))
      .catch(logError);
  },
  onTyping: (event) => void handleTyping(event).catch(logError),
  onError: logError,
  onStickerPacksChange: (ids) => void handleStickerPacksChange(ids).catch(logError),
  onNotificationProfilesChange: (state) => void handleNotificationProfilesChange(state).catch(logError),
  onOwnIdentifierChange: (identifier) => void keyTransparency.onKnownIdentifierChange(identifier).catch(logError),
});

export const groups = new GroupManager(client, db, processor, logError);

/** Signal Secure Backups: runs on the schedule while the chat connection is up */
export const backups = new BackupService({
  store,
  db,
  client,
  appVersion: `TeleSignal ${APP_VERSION}`,
  getIsConnected: () => client.isConnected,
  onChange: () => void handleBackupChange().catch(logError),
  onError: logError,
});

export const keyTransparency = new KeyTransparency(client, db, {
  syncStorage: () => processor.syncStorage(),
  onSelfCheckFailed: () => sendApiUpdate({
    '@type': 'error', error: { message: KEY_TRANSPARENCY_FAILED_ERROR, hasErrorKey: true },
  }),
});

// The Date header of the answers of the chat and storage servers gives the server time (`getServerTime`)
setServerTimeListener((serverTimeOffset) => sendApiUpdate({ '@type': 'updateServerTimeOffset', serverTimeOffset }));

// Safety number change notices; PNI identities belong to phone numbers, which have no conversation of their own
store.onIdentityChange = (serviceId) => {
  if (!isPniServiceId(serviceId)) void processor.addSafetyNumberChange(serviceId).catch(logError);
};

export function logError(error: unknown) {
  // eslint-disable-next-line no-console
  console.error('[signal]', getLoggableError(error));
}
