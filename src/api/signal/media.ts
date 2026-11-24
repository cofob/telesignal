import type { MessageInitShape } from '@bufbuild/protobuf';

import type { AttachmentPointerSchema } from '../../lib/signal/proto/generated/SignalService_pb';
import type { ApiAttachment, ApiDimensions, ApiOnProgress } from '../types';

import { saveAttachmentBlob } from '../../lib/signal/attachments/attachmentCache';
import { uploadAttachment } from '../../lib/signal/attachments/uploadAttachment';
import { AttachmentPointer_Flags } from '../../lib/signal/proto/generated/SignalService_pb';
import { AttachmentUploadError } from '../../lib/signal/sender/sendErrors';
import { bufferFromHex } from '../../util/encoding/buffer';
import { fetchBlob } from '../../util/files';
import { getSafeMimeType } from '../../util/media/safeMimeType';
import { decodeWaveform } from '../../util/waveform';
import { encodeBlurHash } from './media/blurHash';
import { client } from './engine';

// Signal Android and Desktop accept attachments up to 100 MiB
const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
// BlurHash components are smooth, so a small copy of the image gives the same hash
const BLURHASH_SOURCE_SIZE = 64;
// The app's waveform bars range up to 31, Signal's up to 255
const APP_WAVEFORM_MAX = 31;
const SIGNAL_WAVEFORM_MAX = 255;
const UUID_SEPARATOR_REGEX = /-/g;

/**
 * Uploads an attachment that the composer prepared and returns its pointer for `DataMessage.attachments`. A failure
 * is an `AttachmentUploadError`, so that a message that did not send tells it apart from other failures.
 */
export async function uploadMessageAttachment(attachment: ApiAttachment, onProgress?: ApiOnProgress) {
  try {
    return await prepareAndUploadAttachment(attachment, onProgress);
  } catch (err) {
    throw new AttachmentUploadError(err);
  }
}

async function prepareAndUploadAttachment(
  attachment: ApiAttachment, onProgress?: ApiOnProgress,
): Promise<MessageInitShape<typeof AttachmentPointerSchema>> {
  const {
    blobUrl, filename, quick, sourceDimensions, voice, audio, previewBlobUrl, shouldSendAsFile, shouldSendAsGif,
  } = attachment;
  // The composer replaces `blobUrl` with the compressed copy it sends
  const blob = await fetchBlob(blobUrl);
  if (blob.size > MAX_ATTACHMENT_SIZE) throw new Error('Attachment is too large');

  const contentType = blob.type || attachment.mimeType || DEFAULT_CONTENT_TYPE;
  const isImage = contentType.startsWith('image/');
  const isVisual = isImage || contentType.startsWith('video/');
  const dimensions = isVisual ? quick ?? sourceDimensions : undefined;
  const flags = (voice ? AttachmentPointer_Flags.VOICE_MESSAGE : 0)
    | (shouldSendAsGif && !isImage ? AttachmentPointer_Flags.GIF : 0);
  const blurHashSource = isImage ? blob : previewBlobUrl;

  const { connection } = client.getSenderContext();
  const controller = new AbortController();
  const pointer = await uploadAttachment(connection, new Uint8Array(await blob.arrayBuffer()), {
    contentType,
    // Signal Desktop sends photos, videos and voice notes without file names
    fileName: (isVisual && !shouldSendAsFile) || voice ? undefined : filename,
    flags: flags || undefined,
    width: dimensions?.width,
    height: dimensions?.height,
    blurHash: dimensions && blurHashSource ? await computeBlurHash(blurHashSource, dimensions) : undefined,
    audioWaveform: voice ? convertWaveform(voice.waveform) : undefined,
    audioDurationSeconds: contentType.startsWith('audio/') ? (voice ?? audio)?.duration : undefined,
    clientUuid: bufferFromHex(crypto.randomUUID().replace(UUID_SEPARATOR_REGEX, '')),
  }, {
    signal: controller.signal,
    onProgress: (sentLength, totalLength) => {
      if (onProgress?.isCanceled) {
        controller.abort(new Error('Attachment upload is canceled'));
        return;
      }
      onProgress?.(sentLength / totalLength);
    },
  });

  // Sent view-once media keeps no local copy (Signal Desktop `sendNormalMessage` erases it with
  // `eraseMessageContents`); sending it again reuses the uploaded pointer
  if (!attachment.ttlSeconds) {
    await saveAttachmentBlob(pointer, new Blob([blob], { type: getSafeMimeType(contentType) }));
  }
  return pointer;
}

/** BlurHash of an image or a video poster; a source the browser cannot decode gets none */
async function computeBlurHash(source: Blob | string, { width, height }: ApiDimensions) {
  const scale = Math.min(1, BLURHASH_SOURCE_SIZE / Math.max(width, height));
  const resizeWidth = Math.max(1, Math.round(width * scale));
  const resizeHeight = Math.max(1, Math.round(height * scale));

  try {
    const blob = typeof source === 'string' ? await fetchBlob(source) : source;
    const bitmap = await createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'medium' });
    const context = new OffscreenCanvas(resizeWidth, resizeHeight).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return encodeBlurHash(context.getImageData(0, 0, resizeWidth, resizeHeight).data, resizeWidth, resizeHeight);
  } catch {
    return undefined;
  }
}

/** Unpacks the composer's 5-bit waveform (`WaveformAnalyser`) into Signal's byte per bar */
function convertWaveform(waveform: number[]) {
  return Uint8Array.from(
    decodeWaveform(new Uint8Array(waveform)),
    (value) => Math.round((value * SIGNAL_WAVEFORM_MAX) / APP_WAVEFORM_MAX),
  );
}
