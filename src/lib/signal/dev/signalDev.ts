/* eslint-disable no-console */
import type { ConversationRecord } from '../db/MessageDb';
import type { MessageChanges } from '../messages/MessageProcessor';

import { bufferFromBase64 } from '../../../util/encoding/buffer';
import { createStyledQrCode } from '../../../util/qrCode/buildStyledQrCode';
import { callApi } from '../../../api';
import { linkDevice } from '../account/linkDevice';
import { startDeviceLink } from '../account/provisioning';
import { uploadAttachment } from '../attachments/uploadAttachment';
import { deriveMessageBackupKeys } from '../backups/backupStream';
import { importBackupArchive } from '../backups/transferHistory';
import { fetchProfile } from '../profiles/fetchProfile';
import { getAccessKey } from '../sender/sealedSender';
import { sendInitialSyncRequests } from '../sender/syncRequests';
import { lookupUsername, resolveUsernameLink } from '../usernames/lookupUsername';
import { initSignalWasm } from '../wasm';
import { seedDemo } from './seedDemo';

import MessageDb from '../db/MessageDb';
import MessageProcessor from '../messages/MessageProcessor';
import SignalClient from '../SignalClient';
import SignalStore from '../store/SignalStore';

const QR_SIZE = 300;
const DEFAULT_DEVICE_NAME = 'TeleSignal';
const DEFAULT_MESSAGE_LIMIT = 20;

const store = new SignalStore();
const db = new MessageDb();
const client = new SignalClient(store);
const processor = new MessageProcessor(db, client, {
  onChanges: printChanges,
  onTyping: ({ conversationId, senderAci, isTyping }) => {
    console.log(`[signal] ${senderAci} ${isTyping ? 'is typing' : 'stopped typing'} in ${conversationId}`);
  },
  onError: (err) => console.error('[signal]', err),
});
let isConnected = false;

/**
 * Development console API for the Signal engine, until the app UI uses it:
 * `await signalDev.link()` shows a QR code to scan in Signal on the phone, links this browser and starts
 * storing messages; `signalDev.listen()` reconnects later; `signalDev.reset()` forgets the device.
 */
const signalDev = {
  async link(deviceName = DEFAULT_DEVICE_NAME) {
    await initSignalWasm();
    const session = await startDeviceLink();
    await printQrCode(session.url);
    console.log('[signal] Scan the QR code in Signal: Settings > Linked devices > Link new device');
    console.log('[signal] Link URL:', session.url);

    const account = await linkDevice(store, await session.provisionMessage, deviceName);
    console.log(`[signal] Linked as device ${account.deviceId} of ${account.aci}`);
    await signalDev.listen();
    await sendInitialSyncRequests(client.getSenderContext());
    console.log('[signal] Sent sync requests for contacts, configuration, blocked list and keys');
  },

  async listen() {
    await client.connect({
      onContent: (decrypted) => processor.processContent(decrypted),
      onDecryptionError: (envelope, err) => console.warn('[signal] Decryption failed', envelope, err),
      onQueueEmpty: () => console.log('[signal] Queue drained'),
      onClose: (code, reason) => {
        isConnected = false;
        console.log('[signal] Chat socket closed', code, reason);
      },
      onError: (err) => console.error('[signal]', err),
    });
    isConnected = true;
    processor.start();
    console.log('[signal] Connected to the chat socket');
  },

  /** Merges contacts, groups, pins and settings from the storage service, and writes the changes made here */
  async syncStorage() {
    getContext();
    await processor.syncStorage();
    console.log('[signal] Storage service synced');
  },

  async conversations() {
    const conversations = await db.getConversations();
    console.table(conversations
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .map((conversation) => ({
        id: conversation.id,
        type: conversation.type,
        title: getTitle(conversation),
        unread: conversation.unreadCount,
        archived: conversation.isArchived,
        pin: conversation.pinIndex,
        timer: conversation.expireTimer,
      })));
  },

  async messages(conversationId: string, limit = DEFAULT_MESSAGE_LIMIT) {
    const messages = await db.getMessages(conversationId, limit);
    console.table(messages.reverse().map((message) => ({
      id: message.id,
      kind: message.kind,
      from: message.isOutgoing ? 'me' : message.authorAci,
      sentAt: new Date(message.sentAt).toLocaleString(),
      body: message.deletedAt ? '(deleted)' : message.body,
      edited: Boolean(message.editedAt),
      reactions: message.reactions?.map(({ emoji }) => emoji).join(''),
      status: message.recipientStatus && Object.values(message.recipientStatus).join(','),
      read: Boolean(message.readAt),
    })));
  },

  /** Sends a text message to a conversation id from `conversations()`, or to any ACI */
  async send(conversationId: string, text: string) {
    getContext();
    const message = await processor.sendDataMessage(conversationId, { body: text });
    console.log('[signal] Sent', message.sentAt, message.recipientStatus);
  },

  /** Uploads a `File` (for example from an `<input type="file">`) and sends it with an optional caption */
  async sendFile(conversationId: string, file: File, caption?: string) {
    const { connection } = getContext();
    const pointer = await uploadAttachment(connection, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
    });
    const message = await processor.sendDataMessage(conversationId, { body: caption, attachments: [pointer] });
    console.log('[signal] Sent file', message.sentAt, message.recipientStatus);
  },

  /** Prints the ACI behind a username (`name.42`) or a `https://signal.me/#eu/...` link */
  async findUser(usernameOrLink: string) {
    const { unauthenticatedChat } = getContext();
    const username = usernameOrLink.includes('signal.me')
      ? await resolveUsernameLink(unauthenticatedChat, usernameOrLink)
      : usernameOrLink;
    const aci = username ? await lookupUsername(unauthenticatedChat, username) : undefined;
    console.log('[signal]', username, aci ? `is ${aci}; send with signalDev.send('${aci}', 'text')` : 'not found');
  },

  markRead(conversationId: string) {
    getContext();
    return processor.markRead(conversationId);
  },

  /** Prints a decrypted profile; defaults to our own */
  async profile(aci?: string) {
    const { account, connection, unauthenticatedChat } = getContext();
    const profileKey = aci ? (await store.getRecipient(aci))?.profileKey : account.profileKey;
    if (!profileKey) throw new Error('No profile key');
    const accessKey = aci ? await getAccessKey(store, aci) : undefined;
    const unauthenticated = accessKey ? { chat: unauthenticatedChat, accessKey } : undefined;
    console.log('[signal] Profile', await fetchProfile(connection, aci ?? account.aci, profileKey, unauthenticated));
  },

  /** Replaces local data with a demo account, contacts, a group and messages; reload the page afterwards */
  async seedDemo() {
    await waitForEngineStart();
    await initSignalWasm();
    await seedDemo(store, db);
    console.log('[signal] Demo data stored; reload the page');
  },

  /**
   * Imports a link and sync archive file encrypted for this account with `backupKey` (base64), as the link flow
   * does with the archive from the primary device; reload the page afterwards
   */
  async importHistory(archive: Blob, backupKey: string) {
    await initSignalWasm();
    const account = await store.getItem('account');
    if (!account) throw new Error('No account: link or call signalDev.seedDemo() first');
    const keys = deriveMessageBackupKeys(bufferFromBase64(backupKey), account.aci);
    const result = await importBackupArchive(new Uint8Array(await archive.arrayBuffer()), keys, {
      store, processor, account,
    });
    console.log('[signal] Imported message history; reload the page', result);
  },

  async reset() {
    processor.stop();
    client.close();
    isConnected = false;
    await store.clear();
    await db.clear();
    console.log('[signal] Local Signal data removed; unlink the device on the phone too');
  },
};

function printChanges({ conversations, messages, deletedMessages }: MessageChanges) {
  for (const message of messages) {
    const from = message.isOutgoing ? 'me' : message.authorAci;
    const text = message.body ?? message.kind;
    console.log(`[signal] ${message.conversationId} #${message.id} from ${from}:`, text, message);
  }
  if (deletedMessages.length) console.log('[signal] Deleted messages', deletedMessages);
  if (conversations.length) console.log(`[signal] Updated ${conversations.length} conversations`);
}

function getTitle(conversation: ConversationRecord) {
  return conversation.title ?? conversation.nickname ?? conversation.systemName
    ?? ([conversation.profileName, conversation.profileFamilyName].filter(Boolean).join(' ') || conversation.e164);
}

function getContext() {
  if (!isConnected) throw new Error('Not connected: call signalDev.listen() first');
  return client.getSenderContext();
}

/**
 * Waits until the app's engine has started: one that finds no account clears the stored messages and attachments
 * (`discardOrphanedData`), which would remove part of a seed written meanwhile. `callApi` answers only after the start.
 */
async function waitForEngineStart() {
  await callApi('fetchNearestCountry');
}

async function printQrCode(url: string) {
  const qrCode = await createStyledQrCode({ size: QR_SIZE });
  qrCode.update({ data: url, type: 'canvas' });
  const blob = await qrCode.getRawData('png') as Blob;
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  console.log(
    '%c ',
    `padding: ${QR_SIZE / 2}px; background: url(${dataUrl}) no-repeat center / contain, #fff;`,
  );
}

Object.assign(window, { signalDev });
