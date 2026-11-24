/*
 * TeleSignal: the media that Web K sends, in the provider's shapes. Web K uploads a file part by part
 * (`upload.saveFilePart`); the adapter keeps the parts here until the message that carries the file is sent or a group
 * takes it as its avatar (`groupMethods.ts`), and the
 * attributes of the uploaded media (dimensions, duration, waveform, file name, the voice and GIF flags) become the
 * provider's attachment fields.
 */

import type {DocumentAttribute, InputFile, InputMedia} from '@layer';
import type {SignalAttachment, SignalSticker} from '@lib/signal/signalApi';
import makeError from '@helpers/makeError';

// * the MIME type of a photo whose bytes name no other image type
const DEFAULT_PHOTO_MIME_TYPE = 'image/jpeg';
// * the image types by the first bytes of their files, which a photo upload does not name
const IMAGE_SIGNATURES: {mimeType: string, offset: number, bytes: number[]}[] = [
  {mimeType: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47]},
  {mimeType: 'image/gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38]},
  {mimeType: 'image/webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50]},
  {mimeType: 'image/jpeg', offset: 0, bytes: [0xFF, 0xD8, 0xFF]}
];
const IMAGE_SIGNATURE_LENGTH = 12;

// * Signal Android `RemoteConfig.maxAttachmentSizeBytes` (`global.attachments.maxBytes`, 100 MiB by default)
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
// * an upload that got no part for this long was canceled or failed, and its parts are dropped
const STALE_UPLOAD_MS = 10 * 60e3;

type Upload = {parts: Blob[], size: number, touchedAt: number, isRejected?: true};

// * the uploads not taken by a message or a group avatar yet, by the upload's id; a part is a blob, as it is only read
// * to be sent
const uploads = new Map<string, Upload>();

/**
 * Keeps a part of an upload until its message or group avatar takes it; parts may arrive in any order. A file over
 * Signal's limit fails at the first part that shows it: with `totalParts` (a big file's upload), the first part.
 */
export function saveUploadPart(fileId: string | number, filePart: number, bytes: Uint8Array, totalParts?: number) {
  const key = String(fileId);
  const now = Date.now();
  if(!uploads.has(key)) dropStaleUploads(now);

  const upload: Upload = uploads.get(key) ?? {parts: [], size: 0, touchedAt: now};
  upload.touchedAt = now;
  uploads.set(key, upload);
  // * the parts but the last have the same size
  const estimatedSize = totalParts && filePart < totalParts - 1 ? totalParts * bytes.length : 0;
  upload.size += bytes.length - (upload.parts[filePart]?.size ?? 0);
  if(upload.isRejected || Math.max(upload.size, estimatedSize) > MAX_ATTACHMENT_SIZE) {
    // * the entry stays, so that the parts still on the way are refused too, until it is stale
    upload.parts = [];
    upload.isRejected = true;
    throw makeError('FILE_TOO_BIG');
  }

  upload.parts[filePart] = new Blob([bytes.slice()]);
  return true;
}

/** The upload's bytes as one blob, with the file name it was given; all of its parts must be there */
export function takeUpload(file: InputFile, mimeType?: string) {
  // * a document of a story is not uploaded through the file parts, and Web K sends none
  if(file._ === 'inputFileStoryDocument') throw new Error('Signal has no counterpart for this file');
  const key = String(file.id);
  const parts = uploads.get(key)?.parts;
  uploads.delete(key);
  if(!parts || parts.length !== file.parts || Array.from(parts).some((part) => !part)) {
    throw new Error(`The upload ${key} misses parts`);
  }

  return {blob: new Blob(parts, {type: mimeType}), name: file.name};
}

function dropStaleUploads(now: number) {
  uploads.forEach((upload, key) => {
    if(now - upload.touchedAt > STALE_UPLOAD_MS) uploads.delete(key);
  });
}

/**
 * The provider's attachment and sticker of the media of a message that Web K sends. A media that Signal has no
 * counterpart for throws, and so does a sticker that is not of a pack.
 */
export async function buildOutgoingMedia(media: InputMedia): Promise<{attachment?: SignalAttachment, sticker?: SignalSticker}> {
  switch(media._) {
    case 'inputMediaUploadedPhoto':
      return {attachment: await buildPhotoAttachment(media.file)};
    case 'inputMediaUploadedDocument':
      return {attachment: buildDocumentAttachment(media)};
    case 'inputMediaDocument':
      if(media.id._ !== 'inputDocument') throw new Error('Signal has no counterpart for this document');
      return {sticker: buildStickerOf(media.id.id)};
    default:
      throw new Error(`Signal has no counterpart for the media ${media._}`);
  }
}

async function buildPhotoAttachment(file: InputFile): Promise<SignalAttachment> {
  const upload = takeUpload(file);
  const mimeType = await getImageMimeType(upload.blob);
  const blob = new Blob([upload.blob], {type: mimeType});
  const bitmap = await createImageBitmap(blob);
  const {width, height} = bitmap;
  bitmap.close();
  return buildAttachment(blob, {filename: upload.name, mimeType, quick: {width, height}});
}

/** The image type of a photo by the first bytes of its file */
async function getImageMimeType(blob: Blob) {
  const head = new Uint8Array(await blob.slice(0, IMAGE_SIGNATURE_LENGTH).arrayBuffer());
  const signature = IMAGE_SIGNATURES.find(({offset, bytes}) => bytes.every((byte, i) => head[offset + i] === byte));
  return signature?.mimeType ?? DEFAULT_PHOTO_MIME_TYPE;
}

function buildDocumentAttachment(media: Extract<InputMedia, {_: 'inputMediaUploadedDocument'}>): SignalAttachment {
  const {attributes} = media;
  const {blob, name} = takeUpload(media.file, media.mime_type);
  const fileName = attributes.find(isFileNameAttribute)?.file_name ?? name;
  const video = attributes.find(isVideoAttribute);
  const audio = attributes.find(isAudioAttribute);
  const isVoice = audio?.pFlags.voice;
  return buildAttachment(blob, {
    filename: fileName,
    mimeType: media.mime_type,
    quick: video && {width: video.w, height: video.h, duration: video.duration},
    voice: isVoice ? {duration: audio.duration, waveform: Array.from(audio.waveform ?? [])} : undefined,
    audio: audio && !isVoice ? {duration: audio.duration, title: audio.title, performer: audio.performer} : undefined,
    shouldSendAsFile: media.pFlags.force_file || undefined,
    shouldSendAsGif: attributes.some(({_}) => _ === 'documentAttributeAnimated') || undefined
  });
}

function buildAttachment(blob: Blob, fields: Omit<SignalAttachment, 'blobUrl' | 'size' | 'uniqueId'>): SignalAttachment {
  return {
    ...fields,
    blobUrl: URL.createObjectURL(blob),
    size: blob.size,
    uniqueId: crypto.randomUUID()
  };
}

/** A sticker of a pack, which the provider sends with its pack; a sticker of a message is sent again from it */
function buildStickerOf(stickerId: string | number): SignalSticker {
  return {
    mediaType: 'sticker',
    id: String(stickerId),
    stickerSetInfo: {isMissing: true},
    isLottie: false,
    isVideo: false
  };
}

function isFileNameAttribute(attribute: DocumentAttribute): attribute is DocumentAttribute.documentAttributeFilename {
  return attribute._ === 'documentAttributeFilename';
}

function isVideoAttribute(attribute: DocumentAttribute): attribute is DocumentAttribute.documentAttributeVideo {
  return attribute._ === 'documentAttributeVideo';
}

function isAudioAttribute(attribute: DocumentAttribute): attribute is DocumentAttribute.documentAttributeAudio {
  return attribute._ === 'documentAttributeAudio';
}
