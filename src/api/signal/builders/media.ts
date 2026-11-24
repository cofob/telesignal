import type { MessageRecord } from '../../../lib/signal/db/MessageDb';
import type {
  AttachmentPointer, DataMessage, DataMessage_Contact, DataMessage_Sticker,
} from '../../../lib/signal/proto/generated/SignalService_pb';
import type {
  ApiContact, ApiSticker, ApiThumbnail, ApiWebPageFull, MediaContent,
} from '../../types';

import {
  SUPPORTED_AUDIO_CONTENT_TYPES, SUPPORTED_PHOTO_CONTENT_TYPES, SUPPORTED_VIDEO_CONTENT_TYPES,
} from '../../../config';
import { LONG_TEXT_CONTENT_TYPE } from '../../../lib/signal/messages/MessageProcessor';
import { AttachmentPointer_Flags } from '../../../lib/signal/proto/generated/SignalService_pb';
import { getIsStickerPackValid } from '../../../lib/signal/stickers/stickerPackLinks';
import { bufferToHex } from '../../../util/encoding/buffer';
import { getBlurHashDataUri } from '../media/blurHash';
import { getIsValidLinkPreview } from './linkPreviews';
import { STICKER_SIZE } from './stickers';

export const STICKER_SLOT = 's';
// The image of the message's link preview
export const PREVIEW_SLOT = 'p';

type AttachmentSlot = number | typeof STICKER_SLOT | typeof PREVIEW_SLOT;

const MEDIA_ID_REGEX = /^(\d+)_(\d+|s|p)$/;
// The media of story `id` has the id `<id>_story`
const STORY_MEDIA_SUFFIX = '_story';
const STORY_MEDIA_ID_REGEX = /^(\d+)_story$/;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const PHOTO_CONTENT_TYPES = new Set([...SUPPORTED_PHOTO_CONTENT_TYPES, 'image/webp']);
// Signal Desktop `getFileExtension` in `ts/util/Attachment.std.ts`
const FILE_EXTENSIONS: Record<string, string> = {
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'image/jpeg': 'jpg',
};
const MS_PER_SECOND = 1000;
const DATE_PART_LENGTH = 2;
const MILLISECONDS_LENGTH = 3;
const FILE_INDEX_LENGTH = 3;
// `Contact` offers no chat for this id
const UNREGISTERED_CONTACT_ID = '0';
const NON_DIGIT_REGEX = /\D/g;
const VCARD_SPECIAL_CHARACTERS_REGEX = /[\\,;]/g;
const NEW_LINE_REGEX = /\r\n|\r|\n/g;
// Signal Android sends at most 32 attachments in a message (`RemoteConfig.maxAttachmentCount` default); more from a
// crafted message are not shown
const MAX_ALBUM_ITEMS = 32;
// vCard `TYPE`s of `DataMessage.Contact.Phone.Type`, `Email.Type` and `PostalAddress.Type`; custom ones have none
const VCARD_PHONE_TYPES: Record<number, string> = { 1: 'HOME', 2: 'CELL', 3: 'WORK' };
const VCARD_EMAIL_TYPES: Record<number, string> = { 1: 'HOME', 3: 'WORK' };
const VCARD_ADDRESS_TYPES: Record<number, string> = { 1: 'HOME', 2: 'WORK' };
// Signal waveforms have a byte per bar; the app packs 5-bit bars
const BITS_PER_BYTE = 8;
const WAVEFORM_BAR_BITS = 5;
const BYTE_MASK = 0xFF;

/**
 * Media content of a message: photos, videos, documents, audio and voice notes, stickers and shared contacts.
 * Media ids encode the message id and attachment index, so `downloadMedia` can find the attachment pointer.
 */
export function buildMessageMedia(message: MessageRecord, dataMessage: DataMessage): MediaContent {
  const { sticker, attachments, contact } = dataMessage;
  if (sticker?.data) return { sticker: buildSticker(message, sticker, sticker.data) };

  // Several photos and videos show as an album. Otherwise an app message holds one media item, so the first
  // attachment stands for the others. A long text attachment holds the body, not media.
  const media = attachments.map((pointer, index) => (
    getMimeType(pointer.contentType) !== LONG_TEXT_CONTENT_TYPE
      ? buildAttachmentMedia(pointer, {
        id: buildAttachmentMediaId(message.id, index),
        sentAt: message.sentAt,
        index,
        isUnavailable: message.unavailableAttachmentIndexes?.includes(index) || undefined,
      })
      : undefined
  ));
  const albumItems = media.filter((item): item is Pick<MediaContent, 'photo' | 'video'> => Boolean(
    item && (item.photo || (item.video && !item.video.isGif)),
  ));
  if (albumItems.length > 1) {
    const items = albumItems.slice(0, MAX_ALBUM_ITEMS);
    return { ...items[0], album: { mediaType: 'album', items } };
  }
  const first = media.find(Boolean);
  if (first) return first;

  return contact.length ? { contact: buildContact(contact[0]) } : {};
}

/** The photo or video of a media story; `downloadMedia` finds its pointer by the story id */
export function buildStoryMedia(storyId: number, sentAt: number, pointer: AttachmentPointer): MediaContent {
  return buildAttachmentMedia(pointer, { id: `${storyId}${STORY_MEDIA_SUFFIX}`, sentAt, index: 0 });
}

/** The story id of a story media id from `buildStoryMedia` */
export function parseStoryMediaId(mediaId: string) {
  const match = mediaId.match(STORY_MEDIA_ID_REGEX);
  return match ? Number(match[1]) : undefined;
}

/** The message id and attachment slot of a media id: an index in `DataMessage.attachments`, or the sticker */
export function parseAttachmentMediaId(mediaId: string): { messageId: number; slot: AttachmentSlot } | undefined {
  const match = mediaId.match(MEDIA_ID_REGEX);
  if (!match) return undefined;
  const [, messageId, slot] = match;
  return {
    messageId: Number(messageId),
    slot: slot === STICKER_SLOT || slot === PREVIEW_SLOT ? slot : Number(slot),
  };
}

function buildAttachmentMediaId(messageId: number, slot: AttachmentSlot) {
  return `${messageId}_${slot}`;
}

function buildAttachmentMedia(pointer: AttachmentPointer, {
  id, sentAt, index, isUnavailable,
}: { id: string; sentAt: number; index: number; isUnavailable?: true }): MediaContent {
  const mimeType = getMimeType(pointer.contentType);
  const { size, width, height } = pointer;
  const fileName = pointer.fileName || getSuggestedFileName(mimeType, sentAt, index);
  const duration = Math.round(pointer.audioDurationSeconds);

  // Legacy Android voice notes have no flag, only an audio type and no file name
  // (Signal Desktop `isVoiceMessage` in `ts/util/Attachment.std.ts`)
  if (hasFlag(pointer, AttachmentPointer_Flags.VOICE_MESSAGE) || (mimeType.startsWith('audio/') && !pointer.fileName)) {
    return {
      voice: {
        mediaType: 'voice', id, duration, waveform: buildWaveform(pointer.audioWaveform), size, isUnavailable,
      },
    };
  }

  if (PHOTO_CONTENT_TYPES.has(mimeType)) {
    return {
      photo: {
        mediaType: 'photo',
        id,
        date: Math.floor(sentAt / MS_PER_SECOND),
        thumbnail: buildThumbnail(pointer),
        sizes: width && height ? [{ type: 'x', width, height }] : [],
        size,
        isUnavailable,
      },
    };
  }

  if (SUPPORTED_VIDEO_CONTENT_TYPES.has(mimeType)) {
    return {
      video: {
        mediaType: 'video',
        id,
        mimeType,
        // Signal sends no video duration; the player reads it from the file
        duration: 0,
        fileName,
        width: width || undefined,
        height: height || undefined,
        isGif: hasFlag(pointer, AttachmentPointer_Flags.GIF) || undefined,
        thumbnail: buildThumbnail(pointer),
        size,
        isUnavailable,
      },
    };
  }

  if (SUPPORTED_AUDIO_CONTENT_TYPES.has(mimeType)) {
    return {
      audio: {
        mediaType: 'audio', id, size, mimeType, fileName, duration, isUnavailable,
      },
    };
  }

  return {
    document: {
      mediaType: 'document',
      id,
      fileName,
      size,
      timestamp: Math.floor(sentAt / MS_PER_SECOND),
      mimeType,
      isUnavailable,
    },
  };
}

/** A sticker shows from its attachment; its pack opens from the pack id and key it names */
function buildSticker(message: MessageRecord, sticker: DataMessage_Sticker, data: AttachmentPointer): ApiSticker {
  const packId = bufferToHex(sticker.packId);
  const packKey = bufferToHex(sticker.packKey);
  return {
    mediaType: 'sticker',
    id: buildAttachmentMediaId(message.id, STICKER_SLOT),
    stickerSetInfo: getIsStickerPackValid(packId, packKey) ? { id: packId, accessHash: packKey } : { isMissing: true },
    emoji: sticker.emoji || undefined,
    isLottie: false,
    isVideo: false,
    width: data.width || STICKER_SIZE,
    height: data.height || STICKER_SIZE,
    size: data.size,
    isFree: true,
    isUnavailable: message.isStickerUnavailable,
  };
}

/**
 * The link preview of a message as the app's web page. As in Signal Desktop (`ts/util/getValidLinkPreviews.node.ts`),
 * only a safe `https:` link of the message text has a preview.
 */
export function buildWebPage(message: MessageRecord, { body, preview }: DataMessage): ApiWebPageFull | undefined {
  const [first] = preview;
  if (!first || !getIsValidLinkPreview(body, first.url)) return undefined;

  const {
    url, title, description, image,
  } = first;
  const { hostname, pathname } = new URL(url);
  return {
    mediaType: 'webpage',
    webpageType: 'full',
    id: String(message.id),
    url,
    hash: 0,
    displayUrl: `${hostname}${pathname === '/' ? '' : pathname}`,
    siteName: hostname,
    title: title || undefined,
    description: description || undefined,
    photo: image?.contentType.startsWith('image/') ? {
      mediaType: 'photo',
      id: buildAttachmentMediaId(message.id, PREVIEW_SLOT),
      date: Math.floor(Number(first.date || message.sentAt) / MS_PER_SECOND),
      thumbnail: buildThumbnail(image),
      sizes: image.width && image.height ? [{ type: 'x', width: image.width, height: image.height }] : [],
      size: image.size,
    } : undefined,
  };
}

/** A shared contact; `buildApiMessageWithPoll` resolves its user, which needs the database */
function buildContact(contact: DataMessage_Contact): ApiContact {
  const {
    name, number, email, organization,
  } = contact;
  return {
    mediaType: 'contact',
    firstName: name?.givenName || name?.nickname || organization || email[0]?.value || '',
    lastName: name?.familyName ?? '',
    phoneNumber: number[0]?.value.replace(NON_DIGIT_REGEX, '') ?? '',
    userId: UNREGISTERED_CONTACT_ID,
    vcard: buildVcard(contact),
  };
}

/**
 * A vCard 3.0 of a shared contact with its names, numbers, emails, addresses and organization (Signal Android
 * `VCardUtil`): the browser counterpart of adding it to the phone's contacts
 */
function buildVcard({
  name, number, email, address, organization,
}: DataMessage_Contact) {
  const fullName = [name?.prefix, name?.givenName, name?.middleName, name?.familyName, name?.suffix]
    .filter(Boolean).join(' ') || name?.nickname || organization || '';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcardValue(fullName)}`,
    `N:${[name?.familyName, name?.givenName, name?.middleName, name?.prefix, name?.suffix]
      .map((part) => escapeVcardValue(part ?? '')).join(';')}`,
    name?.nickname && `NICKNAME:${escapeVcardValue(name.nickname)}`,
    organization && `ORG:${escapeVcardValue(organization)}`,
    ...number.map(({ value, type }) => `TEL;TYPE=${VCARD_PHONE_TYPES[type] ?? 'VOICE'}:${escapeVcardValue(value)}`),
    ...email.map(({ value, type }) => `EMAIL;TYPE=${VCARD_EMAIL_TYPES[type] ?? 'INTERNET'}:${escapeVcardValue(value)}`),
    ...address.map((item) => `ADR${VCARD_ADDRESS_TYPES[item.type] ? `;TYPE=${VCARD_ADDRESS_TYPES[item.type]}` : ''}:${[
      item.pobox, '', item.street, item.city, item.region, item.postcode, item.country,
    ].map((part) => escapeVcardValue(part ?? '')).join(';')}`),
    'END:VCARD',
  ];
  return lines.filter(Boolean).join('\r\n');
}

function escapeVcardValue(value: string) {
  return value.replace(VCARD_SPECIAL_CHARACTERS_REGEX, '\\$&').replace(NEW_LINE_REGEX, '\\n');
}

/** The BlurHash as a thumbnail; its size is the media size, which layouts read before the media loads */
function buildThumbnail({ blurHash, width, height }: AttachmentPointer): ApiThumbnail | undefined {
  if (!blurHash || !width || !height) return undefined;
  const dataUri = getBlurHashDataUri(blurHash, width, height);
  return dataUri ? { dataUri, width, height } : undefined;
}

/** Packs Signal's 8-bit waveform bars into the app's 5-bit format (`decodeWaveform` in `src/util/waveform.ts`) */
function buildWaveform(bars: Uint8Array) {
  if (!bars.length) return undefined;
  const waveform = new Array<number>(Math.ceil((bars.length * WAVEFORM_BAR_BITS) / BITS_PER_BYTE)).fill(0);
  bars.forEach((bar, i) => {
    const value = bar >> (BITS_PER_BYTE - WAVEFORM_BAR_BITS);
    const bitOffset = i * WAVEFORM_BAR_BITS;
    const byteIndex = Math.floor(bitOffset / BITS_PER_BYTE);
    const bitShift = bitOffset % BITS_PER_BYTE;
    waveform[byteIndex] |= (value << bitShift) & BYTE_MASK;
    if (bitShift > BITS_PER_BYTE - WAVEFORM_BAR_BITS) {
      waveform[byteIndex + 1] |= value >> (BITS_PER_BYTE - bitShift);
    }
  });
  return waveform;
}

/**
 * A file name for attachments sent without one, such as photos and videos
 * (Signal Desktop `getSuggestedFilename` in `ts/util/Attachment.std.ts`)
 */
function getSuggestedFileName(mimeType: string, sentAt: number, index: number) {
  const date = new Date(sentAt);
  const dateParts = [
    date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(),
  ].map((part) => String(part).padStart(DATE_PART_LENGTH, '0'));
  const milliseconds = String(date.getMilliseconds()).padStart(MILLISECONDS_LENGTH, '0');
  const indexSuffix = index ? `_${String(index + 1).padStart(FILE_INDEX_LENGTH, '0')}` : '';
  const extension = FILE_EXTENSIONS[mimeType] ?? mimeType.split('/')[1];
  return `signal-${dateParts.join('-')}-${milliseconds}${indexSuffix}.${extension}`;
}

/** The base type of a content type, without parameters; attachments without one are binary files */
function getMimeType(contentType: string) {
  return contentType.split(';')[0].trim().toLowerCase() || DEFAULT_CONTENT_TYPE;
}

function hasFlag({ flags }: AttachmentPointer, flag: AttachmentPointer_Flags) {
  return Boolean(flags & flag);
}
