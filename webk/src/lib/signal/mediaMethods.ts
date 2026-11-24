/*
 * TeleSignal: the media methods of Web K (downloads, uploads and sticker packs), answered by the Signal provider in
 * Telegram's shapes. Sending a media message stays in the adapter, which owns the pending sends.
 */

import type {InputStickerSet, MethodDeclMap, UploadFile} from '@layer';
import type {SignalSticker, SignalStickerSet} from '@lib/signal/signalApi';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildStickerDocument, getSignalAvatarUrl, getSignalFileUrl} from '@lib/signal/media';
import {saveUploadPart} from '@lib/signal/outgoingMedia';
import {buildStickerSet, buildStickerSetContent, buildStickerSetCovered} from '@lib/signal/stickers';
import {toSignalPeerId} from '@lib/signal/builders';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

// * the provider's `ApiMediaFormat.Progressive`: `downloadMedia` answers the byte range it is asked for
const MEDIA_FORMAT_PROGRESSIVE = 1;

export function buildMediaMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.getAllStickers': () => getAllStickers(host),
    'messages.getFeaturedStickers': () => getFeaturedStickers(host),
    'messages.getRecentStickers': () => getRecentStickers(host),
    'messages.saveRecentSticker': (params) => saveRecentSticker(host, params),
    'messages.clearRecentStickers': () => host.call('clearRecentStickers'),
    'messages.getStickerSet': ({stickerset}) => getStickerSet(host, stickerset),
    'messages.installStickerSet': ({stickerset}) => setStickerSetInstalled(host, stickerset, true),
    'messages.uninstallStickerSet': ({stickerset}) => setStickerSetInstalled(host, stickerset, false),
    // * every file of Web K's downloads comes from the provider's `downloadMedia`, part by part
    'upload.getFile': (params) => getFile(host, params),
    // * the files Web K sends are kept until their message is sent or a group takes one as its avatar
    'upload.saveFilePart': ({file_id, file_part, bytes}) => saveUploadPart(file_id, file_part, bytes),
    'upload.saveBigFilePart': ({file_id, file_part, bytes, file_total_parts}) => (
      saveUploadPart(file_id, file_part, bytes, file_total_parts)
    )
  };
}

async function getAllStickers(host: SignalMethodHost) {
  const result = await host.call<{hash: string, sets: SignalStickerSet[]} | undefined>('fetchStickerSets', {});
  return {_: 'messages.allStickers', hash: result?.hash ?? 0, sets: (result?.sets ?? []).map(buildStickerSet)};
}

async function getFeaturedStickers(host: SignalMethodHost) {
  const result = await host.call<{hash: string, sets: SignalStickerSet[]} | undefined>('fetchFeaturedStickers', {});
  const date = tsNow(true);
  const sets = (result?.sets ?? []).map((set) => buildStickerSetCovered(set, date)).filter(Boolean);
  return {_: 'messages.featuredStickers', pFlags: {}, hash: result?.hash ?? 0, count: sets.length, sets, unread: [] as string[]};
}

async function getRecentStickers(host: SignalMethodHost) {
  const result = await host.call<{hash: string, stickers: SignalSticker[]} | undefined>('fetchRecentStickers', {});
  const date = tsNow(true);
  const stickers = result?.stickers ?? [];
  return {
    _: 'messages.recentStickers',
    hash: result?.hash ?? 0,
    packs: [] as unknown[],
    stickers: stickers.map((sticker) => buildStickerDocument(sticker, date)),
    dates: stickers.map(() => date)
  };
}

/**
 * A sticker leaves the recent ones. Web K saves a sticker it sends, which the provider's send already put first, as
 * in Signal Desktop.
 */
async function saveRecentSticker(host: SignalMethodHost, params: MethodDeclMap['messages.saveRecentSticker']['req']) {
  if(!params.unsave) return true;
  if(params.id._ !== 'inputDocument') throw makeError('SIGNAL_METHOD_UNSUPPORTED' as ErrorType);
  return Boolean(await host.call('removeRecentSticker', {sticker: {id: String(params.id.id)}}));
}

/** A pack by the id and key, or the short name, that its links and stickers name */
async function getStickerSet(host: SignalMethodHost, stickerset: InputStickerSet) {
  const stickerSetInfo = getStickerSetInfo(stickerset);
  const result = stickerSetInfo && await host.call<{set: SignalStickerSet} | undefined>('fetchStickers', {stickerSetInfo})
  .catch((): undefined => undefined);
  if(!result) throw makeError('STICKERSET_INVALID' as ErrorType);

  return {_: 'messages.stickerSet', ...buildStickerSetContent(result.set, tsNow(true))};
}

async function setStickerSetInstalled(host: SignalMethodHost, stickerset: InputStickerSet, isInstalled: boolean) {
  const stickerSetInfo = getStickerSetInfo(stickerset);
  if(!stickerSetInfo || !('id' in stickerSetInfo)) throw makeError('STICKERSET_INVALID' as ErrorType);

  await host.call(isInstalled ? 'installStickerSet' : 'uninstallStickerSet', {
    stickerSetId: stickerSetInfo.id,
    accessHash: stickerSetInfo.accessHash
  });
  return isInstalled ? {_: 'messages.stickerSetInstallResultSuccess'} : true;
}

/** A part of a media of the provider, which Web K's download loop asks for part by part */
async function getFile(host: SignalMethodHost, params: MethodDeclMap['upload.getFile']['req']): Promise<UploadFile.uploadFile> {
  const url = getFileUrl(host, params.location);
  if(!url) throw makeError('SIGNAL_METHOD_UNSUPPORTED' as ErrorType);

  const offset = Number(params.offset);
  const media = await host.call<{arrayBuffer: ArrayBuffer} | undefined>('downloadMedia', {
    url,
    mediaFormat: MEDIA_FORMAT_PROGRESSIVE,
    start: offset,
    end: offset + params.limit - 1
  });
  if(!media) throw makeError('SIGNAL_FILE_UNAVAILABLE' as ErrorType);

  return {_: 'upload.file', type: {_: 'storage.fileUnknown'}, mtime: 0, bytes: new Uint8Array(media.arrayBuffer)};
}

function getFileUrl(host: SignalMethodHost, location: MethodDeclMap['upload.getFile']['req']['location']) {
  if(location._ !== 'inputPeerPhotoFileLocation') return getSignalFileUrl(location);

  const peerId = host.getInputPeerId(location.peer);
  return peerId ? getSignalAvatarUrl(toSignalPeerId(peerId), String(location.photo_id), location.pFlags?.big) : undefined;
}

/** The provider's way to name a sticker pack: by its id and key, or by the short name of a pack this device knows */
function getStickerSetInfo(stickerset: InputStickerSet) {
  switch(stickerset._) {
    case 'inputStickerSetID':
      return {id: String(stickerset.id), accessHash: String(stickerset.access_hash)};
    case 'inputStickerSetShortName':
      return {shortName: stickerset.short_name};
    default:
      return undefined;
  }
}
