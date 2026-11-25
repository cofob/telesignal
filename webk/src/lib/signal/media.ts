/*
 * TeleSignal: Signal media in the Web K shapes (`@layer`). A photo or a document keeps the provider's media id as its
 * id, and a download of it goes back to the provider: `upload.getFile` of `appSignalManager` names the provider's
 * media for the location, `photo<id>` or `document<id>`, and the thumbnail of a media as `?size=<type>`.
 *
 * Several photos and videos of one Signal message show as its paid media already unlocked, the one multi-media
 * shape Web K's bubbles draw; no payment is involved.
 */

import type {
  Document,
  DocumentAttribute,
  InputFileLocation,
  InputStickerSet,
  MessageExtendedMedia,
  MessageMedia,
  Photo,
  PhotoSize,
  WebPage
} from '@layer';
import {EXTENSION_MIME_TYPE_MAP, MIME_TYPE_ALIASES} from '@environment/mimeTypeMap';
import type {
  SignalAlbumItem,
  SignalAudio,
  SignalContact,
  SignalDocument,
  SignalMessage,
  SignalPhoto,
  SignalSticker,
  SignalThumbnail,
  SignalVideo,
  SignalVoice,
  SignalWebPage
} from '@lib/signal/signalApi';

// * the data center of the account, as `getConfig` names it
const DC_ID = 2;
// * Signal Desktop and Android send voice notes as Ogg Opus or AAC; Web K draws a voice note from an Ogg document
const VOICE_MIME_TYPE = 'audio/ogg';
const STICKER_MIME_TYPE = 'image/webp';
// * the size the provider's photos and thumbnails have: the full image, under the type of the one Web K asks for
const PHOTO_SIZE_TYPE = 'x';
const THUMBNAIL_SIZE_TYPE = 'm';

// * the MIME types Web K knows; a Signal file of another type is an octet stream, as a file of unknown type is
const KNOWN_MIME_TYPES: Set<string> = new Set(Object.values(EXTENSION_MIME_TYPE_MAP));

// * link previews by the id of their message, from the `updateEntities` the provider sends with the messages; the
// * oldest go once there are more, as their messages were built when they came
const webPages = new Map<string, SignalWebPage>();
const MAX_WEB_PAGES = 500;

/** Keeps the link previews the provider sends, for the messages that refer to them */
export function storeSignalWebPages(pages: SignalWebPage[] | undefined) {
  pages?.forEach((page) => {
    if(page.webpageType !== 'full') return;
    webPages.delete(page.id);
    webPages.set(page.id, page);
  });
  for(const id of webPages.keys()) {
    if(webPages.size <= MAX_WEB_PAGES) break;
    webPages.delete(id);
  }
}

/**
 * The Web K media of a message's content, or `undefined` for a message without media. A message whose media Web K
 * cannot show yet keeps `undefined` too, and the caller decides what it shows instead.
 */
export function buildSignalMessageMedia(content: SignalMessage['content'], date: number): MessageMedia | undefined {
  const {photo, video, document, sticker, voice, audio, contact, album, webPage} = content;
  if(album?.items.length) return buildAlbumMedia(album.items, date);
  if(photo) return {_: 'messageMediaPhoto', pFlags: {}, photo: buildPhoto(photo)};
  if(video) return {_: 'messageMediaDocument', pFlags: {video: true}, document: buildVideoDocument(video, date)};
  if(voice) {
    return {_: 'messageMediaDocument', pFlags: {voice: true}, document: buildVoiceDocument(voice, date)};
  }

  if(audio) return {_: 'messageMediaDocument', pFlags: {}, document: buildAudioDocument(audio, date)};
  if(document) return {_: 'messageMediaDocument', pFlags: {}, document: buildFileDocument(document, date)};
  if(sticker) return {_: 'messageMediaDocument', pFlags: {}, document: buildStickerDocument(sticker, date)};
  if(contact) return buildContactMedia(contact);
  if(webPage) return buildWebPageMedia(webPage.id);
  return undefined;
}

/** The Telegram photo of a Signal photo, whose size a download reads from `size` */
export function buildPhoto(photo: SignalPhoto): Photo.photo {
  const size = photo.size ?? 0;
  const sizes: PhotoSize.photoSize[] = photo.sizes.length
    ? photo.sizes.map(({width, height}) => ({_: 'photoSize', type: PHOTO_SIZE_TYPE, w: width, h: height, size}))
    : [{_: 'photoSize', type: PHOTO_SIZE_TYPE, w: 0, h: 0, size}];
  return {
    _: 'photo',
    pFlags: {},
    id: photo.id,
    access_hash: '0',
    file_reference: new Uint8Array(),
    date: photo.date,
    sizes,
    dc_id: DC_ID
  };
}

function buildAlbumMedia(items: SignalAlbumItem[], date: number): MessageMedia.messageMediaPaidMedia {
  const extendedMedia = items.map(({photo, video}): MessageExtendedMedia.messageExtendedMedia => ({
    _: 'messageExtendedMedia',
    // * the provider's album items are a photo or a video each
    media: photo ?
      {_: 'messageMediaPhoto', pFlags: {}, photo: buildPhoto(photo)} :
      {_: 'messageMediaDocument', pFlags: {video: true}, document: buildVideoDocument(video!, date)}
  }));
  return {_: 'messageMediaPaidMedia', stars_amount: 0, extended_media: extendedMedia};
}

function buildVideoDocument(video: SignalVideo, date: number): Document.document {
  const attributes: DocumentAttribute[] = [
    {_: 'documentAttributeVideo', pFlags: {supports_streaming: true}, duration: video.duration, w: video.width ?? 0, h: video.height ?? 0},
    {_: 'documentAttributeFilename', file_name: video.fileName}
  ];
  if(video.isGif) attributes.push({_: 'documentAttributeAnimated'});
  return buildDocument({
    id: video.id, date, size: video.size, mimeType: video.mimeType, attributes, thumbnail: video.thumbnail
  });
}

function buildVoiceDocument(voice: SignalVoice, date: number): Document.document {
  return buildDocument({
    id: voice.id,
    date,
    size: voice.size,
    mimeType: VOICE_MIME_TYPE,
    attributes: [{
      _: 'documentAttributeAudio',
      pFlags: {voice: true},
      duration: voice.duration,
      waveform: voice.waveform ? Uint8Array.from(voice.waveform) : undefined
    }]
  });
}

function buildAudioDocument(audio: SignalAudio, date: number): Document.document {
  return buildDocument({
    id: audio.id,
    date,
    size: audio.size,
    mimeType: audio.mimeType,
    attributes: [
      {
        _: 'documentAttributeAudio',
        pFlags: {},
        duration: audio.duration,
        title: audio.title,
        performer: audio.performer
      },
      {_: 'documentAttributeFilename', file_name: audio.fileName}
    ]
  });
}

function buildFileDocument(file: SignalDocument, date: number): Document.document {
  return buildDocument({
    id: file.id ?? '',
    date: file.timestamp ?? date,
    size: file.size,
    mimeType: file.mimeType,
    attributes: [{_: 'documentAttributeFilename', file_name: file.fileName}],
    thumbnail: file.thumbnail
  });
}

/** The Telegram document of a sticker, which opens its pack from the sticker */
export function buildStickerDocument(sticker: SignalSticker, date: number): Document.document {
  const {stickerSetInfo} = sticker;
  return buildDocument({
    id: sticker.id,
    date,
    size: sticker.size ?? 0,
    mimeType: STICKER_MIME_TYPE,
    attributes: [
      {
        _: 'documentAttributeSticker',
        pFlags: {},
        alt: sticker.emoji ?? '',
        stickerset: buildInputStickerSet(stickerSetInfo)
      },
      {_: 'documentAttributeImageSize', w: sticker.width ?? 0, h: sticker.height ?? 0}
    ]
  });
}

/** The pack a sticker of a message opens from, as the provider names it */
function buildInputStickerSet(info: SignalSticker['stickerSetInfo']): InputStickerSet {
  if('id' in info) return {_: 'inputStickerSetID', id: info.id, access_hash: info.accessHash};
  if('shortName' in info) return {_: 'inputStickerSetShortName', short_name: info.shortName};
  return {_: 'inputStickerSetEmpty'};
}

function buildDocument({id, date, size, mimeType, attributes, thumbnail}: {
  id: string,
  date: number,
  size: number,
  mimeType: string,
  attributes: DocumentAttribute[],
  thumbnail?: SignalThumbnail
}): Document.document {
  return {
    _: 'document',
    pFlags: {},
    id,
    access_hash: '0',
    file_reference: new Uint8Array(),
    date,
    dc_id: DC_ID,
    attributes,
    mime_type: toMimeType(mimeType),
    size,
    thumbs: thumbnail ? [{
      _: 'photoSize',
      type: THUMBNAIL_SIZE_TYPE,
      w: thumbnail.width,
      h: thumbnail.height,
      size: 0
    }] : undefined
  };
}

function toMimeType(mimeType: string): MTMimeType {
  const normalized = MIME_TYPE_ALIASES[mimeType] || mimeType;
  return isKnownMimeType(normalized) ? normalized : 'application/octet-stream';
}

function isKnownMimeType(mimeType: string): mimeType is MTMimeType {
  return KNOWN_MIME_TYPES.has(mimeType);
}

function buildContactMedia(contact: SignalContact): MessageMedia.messageMediaContact {
  return {
    _: 'messageMediaContact',
    phone_number: contact.phoneNumber,
    first_name: contact.firstName,
    last_name: contact.lastName,
    vcard: contact.vcard ?? '',
    // * a contact without a chat of its own: messaging it creates one
    user_id: 0
  };
}

/** The link preview of a message, or nothing while the provider has not sent the page */
function buildWebPageMedia(messageId: string): MessageMedia.messageMediaWebPage | undefined {
  const page = webPages.get(messageId);
  if(!page) return undefined;

  const webpage: WebPage.webPage = {
    _: 'webPage',
    pFlags: {},
    id: page.id,
    url: page.url,
    display_url: page.displayUrl,
    hash: page.hash,
    site_name: page.siteName,
    title: page.title,
    description: page.description,
    photo: page.photo ? buildPhoto(page.photo) : undefined
  };
  return {_: 'messageMediaWebPage', pFlags: {}, webpage};
}

/**
 * Whether a paid media is a Signal album: those carry no stars, which Telegram's paid media always does, and so show
 * no price, and no star in the summaries of the messages
 */
export function getIsSignalAlbum(media: MessageMedia.messageMediaPaidMedia) {
  return !Number(media.stars_amount);
}

/**
 * The provider's media of a file location, which `upload.getFile` asks for: a photo or a document by its id, and the
 * thumbnail of it by the type of the size
 */
export function getSignalFileUrl(location: InputFileLocation): string | undefined {
  switch(location._) {
    case 'inputDocumentFileLocation':
      return buildFileUrl('document', location.id, location.thumb_size);
    case 'inputPhotoFileLocation':
      return buildFileUrl('photo', location.id, location.thumb_size);
    default:
      return undefined;
  }
}

function buildFileUrl(kind: 'photo' | 'document', id: string | number, thumbSize?: string) {
  return `${kind}${id}${thumbSize ? `?size=${thumbSize}` : ''}`;
}

/** The provider's avatar of a peer; `big` is the profile picture the peer's profile shows */
export function getSignalAvatarUrl(signalPeerId: string, avatarPhotoId: string, isBig?: boolean) {
  return `${isBig ? 'profile' : 'avatar'}${signalPeerId}?${avatarPhotoId}`;
}
