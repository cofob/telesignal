/*
 * TeleSignal: the media methods of Web K (downloads, uploads and sticker packs), answered by the Signal provider in
 * Telegram's shapes. Sending a media message stays in the adapter, which owns the pending sends.
 */

import type {InputPeer, InputStickerSet, MessagesFilter, MethodDeclMap, UploadFile} from '@layer';
import type {SignalMessage, SignalSticker, SignalStickerSet} from '@lib/signal/signalApi';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildStickerDocument, getSignalAvatarUrl, getSignalFileUrl} from '@lib/signal/media';
import {saveUploadPart} from '@lib/signal/outgoingMedia';
import {buildStickerSet, buildStickerSetContent, buildStickerSetCovered} from '@lib/signal/stickers';
import {toSignalPeerId} from '@lib/signal/builders';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

// * the provider's `ApiMediaFormat.Progressive`: `downloadMedia` answers the byte range it is asked for
const MEDIA_FORMAT_PROGRESSIVE = 1;
// * the provider's shared media tabs of Telegram's search filters
const SHARED_MEDIA_TYPES: Partial<Record<MessagesFilter['_'], string>> = {
  inputMessagesFilterPhotoVideo: 'media',
  inputMessagesFilterDocument: 'documents',
  inputMessagesFilterUrl: 'links',
  inputMessagesFilterMusic: 'audio',
  inputMessagesFilterVoice: 'voice',
  inputMessagesFilterRoundVoice: 'voice',
  inputMessagesFilterGif: 'gif'
};
// * the photos and videos that the profile counts in the media tab, which lists them together
const MEDIA_ITEM_FILTERS: Set<MessagesFilter['_']> = new Set(['inputMessagesFilterPhotos', 'inputMessagesFilterVideo']);

export function buildMediaMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.getSearchCounters': ({peer, filters}) => getSearchCounters(host, peer, filters),
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
    // * the files Web K sends are kept until their message is sent, which the provider does with them
    'upload.saveFilePart': (params) => storeUploadPart(params),
    'upload.saveBigFilePart': (params) => storeUploadPart(params)
  };
}

/** The provider's shared media tab of a search filter, or nothing for a filter that Signal has no tab for */
export function getSharedMediaSearchType(filter: MessagesFilter) {
  return SHARED_MEDIA_TYPES[filter._];
}

/**
 * The number of messages of each shared media tab, and of the photos and videos of the media tab; a filter that Signal
 * has no tab for counts none
 */
async function getSearchCounters(host: SignalMethodHost, inputPeer: InputPeer, filters: MessagesFilter[]) {
  const peerId = host.getInputPeerId(inputPeer);
  const peer = peerId && {id: toSignalPeerId(peerId)};
  const counts = peer && await host.call<Record<string, number> | undefined>('fetchSharedMediaCounts', {peer});
  const mediaCount = counts?.media ?? 0;
  const mediaItemCounts = filters.some((filter) => MEDIA_ITEM_FILTERS.has(filter._)) && mediaCount ?
    await countMediaItems(host, peer, mediaCount) :
    undefined;
  return filters.map((filter) => ({
    _: 'messages.searchCounter',
    pFlags: {},
    filter,
    count: MEDIA_ITEM_FILTERS.has(filter._) ?
      mediaItemCounts?.[filter._ === 'inputMessagesFilterPhotos' ? 'photos' : 'videos'] ?? 0 :
      counts?.[getSharedMediaSearchType(filter)] ?? 0
  }));
}

/** The photos and videos of a chat's media messages, an album counting each of its items */
async function countMediaItems(host: SignalMethodHost, peer: {id: string}, limit: number) {
  const result = await host.call<{messages: SignalMessage[]} | undefined>('searchMessagesInChat', {peer, type: 'media', limit});
  const items = (result?.messages ?? []).flatMap(({content}) => content.album?.items ?? [content]);
  return {photos: items.filter(({photo}) => photo).length, videos: items.filter(({video}) => video).length};
}

function storeUploadPart(params: MethodDeclMap['upload.saveFilePart']['req'] | MethodDeclMap['upload.saveBigFilePart']['req']) {
  saveUploadPart(params.file_id, params.file_part, params.bytes);
  return true;
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
