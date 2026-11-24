/*
 * TeleSignal: the media that Web K sends, in the provider's shapes. Web K uploads a file part by part
 * (`upload.saveFilePart`); the adapter keeps the parts here until the message that carries the file is sent, and the
 * attributes of the uploaded media (dimensions, duration, waveform, file name, the voice and GIF flags) become the
 * provider's attachment fields.
 */

import type {DocumentAttribute, InputFile, InputMedia} from '@layer';
import type {SignalAttachment, SignalSticker} from '@lib/signal/signalApi';

// * the MIME type of a photo Web K uploads, which it compresses to JPEG
const PHOTO_MIME_TYPE = 'image/jpeg';

// * the parts of the uploads not sent yet, by the upload's id; a part is a blob, as it is only read to be sent
const uploadedParts = new Map<string, Blob[]>();

/** Keeps a part of an upload until its message is sent; parts may arrive in any order */
export function saveUploadPart(fileId: string | number, filePart: number, bytes: Uint8Array) {
  const key = String(fileId);
  const parts = uploadedParts.get(key) ?? [];
  parts[filePart] = new Blob([bytes.slice()]);
  uploadedParts.set(key, parts);
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
  const {blob, name} = takeUpload(file, PHOTO_MIME_TYPE);
  const bitmap = await createImageBitmap(blob);
  const {width, height} = bitmap;
  bitmap.close();
  return buildAttachment(blob, {filename: name, mimeType: PHOTO_MIME_TYPE, quick: {width, height}});
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

/** The upload's bytes as one blob, with the file name it was given; all of its parts must be there */
function takeUpload(file: InputFile, mimeType: string) {
  // * a document of a story is not uploaded through the file parts, and Web K sends none
  if(file._ === 'inputFileStoryDocument') throw new Error('Signal has no counterpart for this file');
  const key = String(file.id);
  const parts = uploadedParts.get(key);
  uploadedParts.delete(key);
  if(!parts || parts.length !== file.parts || Array.from(parts).some((part) => !part)) {
    throw new Error(`The upload ${key} misses parts`);
  }

  return {blob: new Blob(parts, {type: mimeType}), name: file.name};
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
