import { fromBinary } from '@bufbuild/protobuf';

import type { AttachmentPointer } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ApiOnProgress } from '../../types';

import {
  ATTACHMENT_CACHE_NAME, fetchCachedBlob, getAttachmentCacheKey, saveCachedBlob,
} from '../../../lib/signal/attachments/attachmentCache';
import { AttachmentUnavailableError, downloadAttachment } from '../../../lib/signal/attachments/downloadAttachment';
import { DataMessageSchema, StoryMessageSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import * as cacheApi from '../../../util/cacheApi';
import { getSafeMimeType } from '../../../util/media/safeMimeType';
import {
  parseAttachmentMediaId, parseStoryMediaId, PREVIEW_SLOT, STICKER_SLOT,
} from '../builders/media';
import { db } from '../engine';

type DownloadState = {
  controller: AbortController;
  callbacks: Set<ApiOnProgress>;
  // A request without a progress callback cannot cancel, so the download continues for it
  hasUncancelableRequest?: boolean;
  reportedProgress: number;
};

type Download = DownloadState & {
  promise: Promise<Blob>;
};

const PROGRESS_STEP = 0.01;

const downloads = new Map<string, Download>();
// Serves the parts of a streamed file while it is being saved, or when the cache is unavailable
let lastDownloaded: { key: string; blob: Blob } | undefined;

/**
 * The attachment pointer that a media id from `buildMessageMedia` refers to. Throws `AttachmentUnavailableError`
 * when the CDN no longer has the attachment.
 */
export async function getAttachmentPointer(mediaId: string) {
  const storyId = parseStoryMediaId(mediaId);
  if (storyId !== undefined) {
    const story = await db.getStory(storyId);
    const { attachment } = story ? fromBinary(StoryMessageSchema, story.storyMessage) : {};
    return attachment?.case === 'fileAttachment' ? attachment.value : undefined;
  }

  const parsed = parseAttachmentMediaId(mediaId);
  if (!parsed) return undefined;
  const message = await db.getMessage(parsed.messageId);
  if (!message?.dataMessage) return undefined;
  const { slot } = parsed;
  const isUnavailable = slot === STICKER_SLOT
    ? message.isStickerUnavailable
    : typeof slot === 'number' && message.unavailableAttachmentIndexes?.includes(slot);
  if (isUnavailable) throw new AttachmentUnavailableError();

  const { attachments, sticker, preview } = fromBinary(DataMessageSchema, message.dataMessage);
  if (slot === STICKER_SLOT) return sticker?.data;
  return slot === PREVIEW_SLOT ? preview[0]?.image : attachments[slot];
}

/**
 * The decrypted attachment, from the cache or the CDN. Requests for the same attachment share one download,
 * which stops once every request with a progress callback is canceled.
 */
export async function fetchAttachmentBlob(pointer: AttachmentPointer, onProgress?: ApiOnProgress) {
  const key = getAttachmentCacheKey(pointer);
  if (lastDownloaded?.key === key) return lastDownloaded.blob;

  const cached = await fetchCachedBlob(key);
  if (cached) return cached;

  const download = downloads.get(key) ?? startDownload(key, pointer);
  if (onProgress) {
    download.callbacks.add(onProgress);
  } else {
    download.hasUncancelableRequest = true;
  }
  return download.promise;
}

/** Drops the in-memory copy of attachments that are erased, such as the media of an opened view-once message */
export function forgetDownloadedAttachments(pointers: AttachmentPointer[]) {
  const keys = new Set(pointers.map(getAttachmentCacheKey));
  if (lastDownloaded && keys.has(lastDownloaded.key)) lastDownloaded = undefined;
}

export async function clearAttachmentCache() {
  lastDownloaded = undefined;
  await cacheApi.clear(ATTACHMENT_CACHE_NAME);
}

function startDownload(key: string, pointer: AttachmentPointer) {
  const state: DownloadState = { controller: new AbortController(), callbacks: new Set(), reportedProgress: 0 };
  const download: Download = Object.assign(state, {
    promise: downloadToCache(key, pointer, state).finally(() => downloads.delete(key)),
  });
  downloads.set(key, download);
  return download;
}

async function downloadToCache(key: string, pointer: AttachmentPointer, state: DownloadState) {
  const data = await downloadAttachment(pointer, {
    signal: state.controller.signal,
    onProgress: (receivedLength, totalLength) => {
      if (totalLength) reportProgress(state, receivedLength / totalLength);
    },
  });
  const blob = new Blob([data], { type: getSafeMimeType(pointer.contentType) });
  lastDownloaded = { key, blob };
  await saveCachedBlob(key, blob);
  return blob;
}

function reportProgress(state: DownloadState, progress: number) {
  const activeCallbacks = [...state.callbacks].filter((callback) => !callback.isCanceled);
  if (state.callbacks.size && !activeCallbacks.length && !state.hasUncancelableRequest) {
    state.controller.abort(new Error('Attachment download is canceled'));
    return;
  }

  if (progress < 1 && progress - state.reportedProgress < PROGRESS_STEP) return;
  state.reportedProgress = progress;
  activeCallbacks.forEach((callback) => callback(progress));
}
