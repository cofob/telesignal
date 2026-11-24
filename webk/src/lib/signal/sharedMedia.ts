/*
 * TeleSignal: the shared media of Web K's profile and search tabs (photos and videos, files, links, music and voice
 * messages), which the provider finds by reading the stored messages, as for Web A's shared media.
 */

import type {MessagesFilter, MethodDeclMap} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {toSignalPeerId} from '@lib/signal/builders';

type SharedMediaCounts = {photos: number, videos: number, documents: number, links: number, audio: number, voice: number};

// * the provider's search type of each Telegram filter; Signal has no GIF, poll, location or chat photo filters
const SEARCH_TYPE_BY_FILTER: Partial<Record<MessagesFilter['_'], string>> = {
  inputMessagesFilterEmpty: 'text',
  inputMessagesFilterPhotoVideo: 'media',
  inputMessagesFilterDocument: 'documents',
  inputMessagesFilterUrl: 'links',
  inputMessagesFilterMusic: 'audio',
  inputMessagesFilterVoice: 'voice',
  inputMessagesFilterRoundVoice: 'voice'
};

const COUNT_BY_FILTER: Partial<Record<MessagesFilter['_'], (counts: SharedMediaCounts) => number>> = {
  inputMessagesFilterPhotos: (counts) => counts.photos,
  inputMessagesFilterVideo: (counts) => counts.videos,
  inputMessagesFilterPhotoVideo: (counts) => counts.photos + counts.videos,
  inputMessagesFilterDocument: (counts) => counts.documents,
  inputMessagesFilterUrl: (counts) => counts.links,
  inputMessagesFilterMusic: (counts) => counts.audio,
  inputMessagesFilterVoice: (counts) => counts.voice,
  inputMessagesFilterRoundVoice: (counts) => counts.voice
};

export function buildSharedMediaHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'messages.getSearchCounters': (params: MethodDeclMap['messages.getSearchCounters']['req']) => getSearchCounters(host, params)
  };
}

/** The provider's search type of a Telegram filter, or `undefined` for a filter Signal has no messages of */
export function getSearchType(filter: MessagesFilter | undefined) {
  return SEARCH_TYPE_BY_FILTER[filter?._ ?? 'inputMessagesFilterEmpty'];
}

/** How many messages each filter finds, which Web K shows on its tabs and hides the empty ones by */
async function getSearchCounters(host: SignalMethodHost, params: MethodDeclMap['messages.getSearchCounters']['req']) {
  const peerId = host.getInputPeerId(params.peer);
  const hasCountedFilter = params.filters.some((filter) => COUNT_BY_FILTER[filter._]);
  const counts: SharedMediaCounts | undefined = peerId && hasCountedFilter ?
    await host.call('fetchSharedMediaCounts', {chat: {id: toSignalPeerId(peerId)}}) :
    undefined;
  return params.filters.map((filter) => ({
    _: 'messages.searchCounter',
    pFlags: {},
    filter,
    count: counts ? COUNT_BY_FILTER[filter._]?.(counts) ?? 0 : 0
  }));
}
