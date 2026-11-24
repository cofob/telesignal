/*
 * TeleSignal: view-once media in Web K, opened once as Signal Desktop's `showLightboxForViewOnceMedia`
 * (`ts/state/ducks/lightbox.preload.ts`) opens it: the media is loaded, the message is marked viewed, which erases the
 * media in the engine, and only then the viewer shows the loaded copy. The copy is an object URL in the worker's
 * thumbs storage, which the viewer finds before it would download the file, so it never reaches Web K's file caches;
 * closing the viewer revokes it.
 */

import type {Document, Message, MessageMedia, Photo} from '@layer';
import type {SignalMethodHost} from '@lib/signal/methodHost';
import type ThumbsStorage from '@lib/storages/thumbs';
import {getSignalFileUrl} from '@lib/signal/media';
import {toSignalPeerId} from '@lib/signal/builders';
import CacheStorageController from '@lib/files/cacheStorage';

// * the provider's `ApiMediaFormat.BlobUrl`: `downloadMedia` answers the whole file as a blob
const MEDIA_FORMAT_BLOB_URL = 0;
// * the caches of downloaded files and of streamed parts, whose entries name the file's id
const FILE_CACHES = [new CacheStorageController('cachedFiles'), new CacheStorageController('cachedStreamChunks')];

type ViewOnceMedia = Photo.photo | Document.document;

/** The photo or video of an unopened view-once message, or `undefined` for any other message */
export function getViewOnceMedia(message: Message | undefined): ViewOnceMedia | undefined {
  const media = (message as Message.message)?.media as MessageMedia.messageMediaPhoto | MessageMedia.messageMediaDocument;
  if(!media?.ttl_seconds) return undefined;
  const file = media._ === 'messageMediaPhoto' ? media.photo : media.document;
  return file?._ === 'photo' || file?._ === 'document' ? file : undefined;
}

/** Loads view-once media into the thumbs storage and marks it viewed; `false` when it could not be loaded */
export async function openViewOnceMedia(
  host: SignalMethodHost, thumbsStorage: ThumbsStorage, peerId: PeerId, mid: number, media: ViewOnceMedia
) {
  const url = getSignalFileUrl(media._ === 'photo' ?
    {_: 'inputPhotoFileLocation', id: media.id, access_hash: 0, file_reference: new Uint8Array(), thumb_size: ''} :
    {_: 'inputDocumentFileLocation', id: media.id, access_hash: 0, file_reference: new Uint8Array(), thumb_size: ''});
  const result: {dataBlob?: Blob} | undefined = url && await host.call('downloadMedia', {url, mediaFormat: MEDIA_FORMAT_BLOB_URL});
  if(!(result?.dataBlob instanceof Blob)) return false;

  await host.call('markMessagesRead', {chat: {id: toSignalPeerId(peerId)}, messageIds: [mid]});
  const blob = result.dataBlob;
  for(const thumbSize of getThumbSizes(media)) {
    thumbsStorage.setCacheContextBlob(media, thumbSize, blob, blob.size);
  }
  await deleteCachedFiles(String(media.id));
  return true;
}

/** Lets go of the loaded copy of view-once media once its viewer closed */
export function closeViewOnceMedia(thumbsStorage: ThumbsStorage, media: ViewOnceMedia) {
  for(const thumbSize of getThumbSizes(media)) thumbsStorage.deleteCacheContext(media, thumbSize);
}

// * the sizes the viewer asks for: each size of a photo, and the whole file of a video
function getThumbSizes(media: ViewOnceMedia) {
  return media._ === 'photo' ? media.sizes.map((size) => size.type) : [undefined];
}

/** Removes any file or streamed part of the media that Web K's caches hold, which an earlier load may have left */
async function deleteCachedFiles(mediaId: string) {
  for(const storage of FILE_CACHES) {
    await storage.timeoutOperation(async(cache) => {
      for(const request of await cache.keys()) {
        const entry = decodeURIComponent(request.url.replace(/%u002E/g, '.'));
        if(entry.includes(`_${mediaId}`) || entry.includes(`-${mediaId}?`)) await cache.delete(request);
      }
    });
  }
}
