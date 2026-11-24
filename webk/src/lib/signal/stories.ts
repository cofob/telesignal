/*
 * TeleSignal: Signal stories in Web K's shapes, answered by the provider's story methods (`src/api/signal/methods/
 * stories.ts`), which Web A's story viewer uses. A story belongs to its author, or to its group: a group story is a
 * story of the group's chat, naming its author. Signal stories live a day and have no archive, profile stories,
 * albums, links, stealth mode or reports; their reactions are emoji replies, which cannot be taken back.
 */

import type {
  Chat,
  InputReplyTo,
  MessageMedia,
  MethodDeclMap,
  PeerStories,
  RecentStory,
  StoryItem,
  StoryView,
  StoryViews,
  Update,
  User
} from '@layer';
import type {
  SignalPeerStories,
  SignalStory,
  SignalStoryItem,
  SignalStoryPhoto,
  SignalStoryVideo,
  SignalStoryView,
  SignalStoryViews,
  SignalTypeStory
} from '@lib/signal/storiesApi';
import type {SignalApiUpdate} from '@lib/signal/signalApi';
import type {SignalNewStory} from '@lib/signal/storySettingsApi';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import {buildEntity, buildPeer, toPeerId, toSignalPeerId} from '@lib/signal/builders';
import {buildReaction, toSignalReaction} from '@lib/signal/reactions';
import makeError from '@helpers/makeError';
import tsNow from '@helpers/tsNow';

// * the data center of the account, as the adapter's `getConfig` names it
const DC_ID = 2;
// * the provider's photos have the full image only, and a download names the size it asks for (`upload.getFile`)
const PHOTO_SIZE_TYPE = 'x';
const THUMBNAIL_SIZE_TYPE = 'm';
const UNSUPPORTED_ERROR = 'SIGNAL_METHOD_UNSUPPORTED';

type PeerRef = {id: string};

export function buildStoryMethodHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'stories.getAllStories': (params: MethodDeclMap['stories.getAllStories']['req']) => getAllStories(host, params),
    'stories.getPeerStories': ({peer}: MethodDeclMap['stories.getPeerStories']['req']) => getPeerStories(host, peer),
    'stories.getStoriesByID': ({peer, id}: MethodDeclMap['stories.getStoriesByID']['req']) => getStoriesById(host, peer, id),
    'stories.getPeerMaxIDs': ({id}: MethodDeclMap['stories.getPeerMaxIDs']['req']) => getPeerMaxIds(host, id),
    'stories.readStories': ({peer, max_id}: MethodDeclMap['stories.readStories']['req']) => readStories(host, peer, max_id),
    // * a view is counted by its read receipt (`stories.readStories`)
    'stories.incrementStoryViews': () => true,
    'stories.getStoriesViews': ({peer, id}: MethodDeclMap['stories.getStoriesViews']['req']) => getStoriesViews(host, peer, id),
    'stories.getStoryViewsList': (params: MethodDeclMap['stories.getStoryViewsList']['req']) => getStoryViewsList(host, params),
    'stories.sendReaction': (params: MethodDeclMap['stories.sendReaction']['req']) => sendReaction(host, params),
    'stories.deleteStories': ({peer, id}: MethodDeclMap['stories.deleteStories']['req']) => deleteStories(host, peer, id),
    'stories.togglePeerStoriesHidden': (params: MethodDeclMap['stories.togglePeerStoriesHidden']['req']) => (
      togglePeerStoriesHidden(host, params)
    ),
    // * Signal has no profile stories or archive: a story lives a day, then it is gone
    'stories.getPinnedStories': emptyStories,
    'stories.getStoriesArchive': emptyStories,
    // * the feed carries how far every peer with stories has read them
    'stories.getAllReadPeerStories': () => ({_: 'updates', updates: [], users: [], chats: [], date: tsNow(true), seq: 0})
  };
}

/** The Telegram updates of the provider's story updates, or nothing for an update of another kind */
export function buildStoryUpdates(update: SignalApiUpdate): Update[] | undefined {
  switch(update['@type']) {
    case 'updateStory':
      return [{_: 'updateStory', peer: buildPeer(update.peerId), story: buildStoryItem(update.story)}];
    case 'deleteStory':
      return [{_: 'updateStory', peer: buildPeer(update.peerId), story: {_: 'storyItemDeleted', id: update.storyId}}];
    case 'updateReadStories':
      return [{_: 'updateReadStories', peer: buildPeer(update.peerId), max_id: update.lastReadId}];
    default:
      return undefined;
  }
}

function emptyStories(): MethodDeclMap['stories.getPinnedStories']['res'] {
  return {_: 'stories.stories', count: 0, stories: [], chats: [], users: [], pinned_to_top: []};
}

/** Every peer's stories come in one answer: there is no next page */
async function getAllStories(host: SignalMethodHost, params: MethodDeclMap['stories.getAllStories']['req']) {
  const result: {peerStories: Record<string, SignalPeerStories>} | undefined = params.next ?
    undefined :
    await host.call('fetchAllStories', {isHidden: params.hidden || undefined});
  const peerStories = Object.entries(result?.peerStories ?? {}).map(([peerId, stories]) => buildPeerStories(peerId, stories));
  return {
    _: 'stories.allStories',
    pFlags: {},
    count: peerStories.length,
    state: 'signal',
    peer_stories: peerStories,
    ...getPeers(host, peerStories),
    stealth_mode: {_: 'storiesStealthMode', pFlags: {}}
  };
}

async function getPeerStories(host: SignalMethodHost, inputPeer: any) {
  const peer = getPeerRef(host, inputPeer);
  const result: {stories: Record<number, SignalTypeStory>, lastReadStoryId?: number} | undefined = peer &&
    await host.call('fetchPeerStories', {peer});
  if(!peer) throw makeError('PEER_ID_INVALID' as ErrorType);

  const stories = buildPeerStories(peer.id, {
    byId: result?.stories ?? {},
    orderedIds: Object.keys(result?.stories ?? {}).map(Number).sort((a, b) => a - b),
    lastReadId: result?.lastReadStoryId
  });
  return {_: 'stories.peerStories', stories, ...getPeers(host, [stories])};
}

async function getStoriesById(host: SignalMethodHost, inputPeer: any, ids: number[]) {
  const peer = getPeerRef(host, inputPeer);
  const result: {stories: Record<number, SignalTypeStory>} | undefined = peer &&
    await host.call('fetchPeerStoriesByIds', {peer, ids});
  const stories = Object.values(result?.stories ?? {}).map(buildStoryItem);
  return {
    _: 'stories.stories',
    count: stories.length,
    stories,
    ...getPeers(host, [{_: 'peerStories', peer: buildPeer(peer?.id ?? '0'), stories}]),
    pinned_to_top: [] as number[]
  };
}

/** The newest story of each peer, from the feed of shown and hidden stories */
async function getPeerMaxIds(host: SignalMethodHost, inputPeers: any[]): Promise<RecentStory[]> {
  const [shown, hidden] = await Promise.all([false, true].map((isHidden) => (
    host.call<{peerStories: Record<string, SignalPeerStories>} | undefined>('fetchAllStories', {isHidden: isHidden || undefined})
  )));
  return inputPeers.map((inputPeer) => {
    const peerId = getPeerRef(host, inputPeer)?.id;
    const stories = peerId && (shown?.peerStories[peerId] ?? hidden?.peerStories[peerId]);
    const maxId = stories?.orderedIds[stories.orderedIds.length - 1];
    return {_: 'recentStory', pFlags: {}, max_id: maxId};
  });
}

/** Views the stories up to `maxId` that are not viewed yet; each sends a viewed receipt if story view receipts are on */
async function readStories(host: SignalMethodHost, inputPeer: any, maxId: number) {
  const peer = getPeerRef(host, inputPeer);
  const result: {stories: Record<number, SignalTypeStory>, lastReadStoryId?: number} | undefined = peer &&
    await host.call('fetchPeerStories', {peer});
  if(!result) return [];

  const ids = Object.keys(result.stories).map(Number)
  .filter((id) => id <= maxId && id > (result.lastReadStoryId ?? 0))
  .sort((a, b) => a - b);
  for(const storyId of ids) {
    await host.call('markStoryRead', {peer, storyId});
  }

  return ids;
}

async function getStoriesViews(host: SignalMethodHost, inputPeer: any, ids: number[]) {
  const peer = getPeerRef(host, inputPeer);
  const views = await Promise.all(ids.map(async(storyId) => {
    const result: {views: SignalStoryViews} | undefined = peer && await host.call('fetchStoriesViews', {peer, storyIds: [storyId]});
    return buildStoryViews(result?.views ?? {});
  }));
  return {_: 'stories.storyViews', views, users: [] as User[]};
}

/**
 * Who viewed our story, with their reactions, in one page, which is searched, kept to contacts and sorted here. Text
 * replies to a story of ours come to its chat, as Signal shows them; Signal sends no forwards or reposts of stories.
 */
async function getStoryViewsList(host: SignalMethodHost, params: MethodDeclMap['stories.getStoryViewsList']['req']) {
  // * there is no next page
  if(params.offset) {
    return buildStoryViewsList(host, []);
  }

  const peer = getPeerRef(host, params.peer);
  const result: {views: SignalStoryView[]} | undefined = peer && await host.call('fetchStoryViewList', {peer, storyId: params.id});
  if(!result) throw makeError('STORY_ID_INVALID' as ErrorType);

  const {appPeersManager} = host.getManagers();
  const query = params.q?.toLowerCase();
  const views = result.views.map(buildStoryView).filter((view) => {
    if(!view) return false;
    const user = appPeersManager.getPeer(toPeerId(view.user_id)) as User.user;
    if(params.just_contacts && !user?.pFlags.contact) return false;
    return !query || [user?.first_name, user?.last_name].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  if(params.reactions_first) {
    views.sort((a, b) => Number(!!b.reaction) - Number(!!a.reaction) || b.date - a.date);
  }

  return buildStoryViewsList(host, views);
}

function buildStoryViewsList(host: SignalMethodHost, views: StoryView.storyView[]) {
  const {appPeersManager} = host.getManagers();
  return {
    _: 'stories.storyViewsList',
    count: views.length,
    views_count: views.length,
    forwards_count: 0,
    reactions_count: views.filter(({reaction}) => reaction).length,
    views,
    chats: [] as Chat[],
    users: views.map(({user_id}) => appPeersManager.getPeer(toPeerId(user_id))).filter(Boolean) as User[]
  };
}

/** A Signal reaction is an emoji reply to the story: it cannot be taken back, and Signal has no custom emoji */
async function sendReaction(host: SignalMethodHost, params: MethodDeclMap['stories.sendReaction']['req']) {
  const reaction = toSignalReaction(params.reaction);
  const peer = getPeerRef(host, params.peer);
  if(!reaction || !peer) throw makeError(UNSUPPORTED_ERROR as ErrorType);

  const isSent = await host.call<true | undefined>('sendStoryReaction', {peer, storyId: params.story_id, reaction});
  if(!isSent) throw makeError('SIGNAL_SEND_FAILED' as ErrorType);
  // * the story comes back with our reaction once the engine stored it
  return {_: 'updates', updates: [] as Update[], users: [] as User[], chats: [] as Chat[], date: tsNow(true), seq: 0};
}

/**
 * Replies to a story with text: privately to its author, or in its group, as Signal sends it. The provider reports a
 * reply it could not send as an error update, which the adapter shows; a 1:1 reply comes back as a message of the chat.
 */
export async function sendStoryReply(
  host: SignalMethodHost,
  params: MethodDeclMap['messages.sendMessage']['req'],
  entities: unknown[]
) {
  const replyTo = params.reply_to as InputReplyTo.inputReplyToStory;
  const peer = getPeerRef(host, replyTo.peer);
  if(!peer || !params.message) throw makeError(UNSUPPORTED_ERROR as ErrorType);

  await host.call('sendMessage', {
    chat: peer,
    text: params.message,
    entities,
    replyInfo: {type: 'story', peerId: peer.id, storyId: replyTo.story_id}
  });
  return {_: 'updates', updates: [] as Update[], users: [] as User[], chats: [] as Chat[], date: tsNow(true), seq: 0};
}

/**
 * Sends a new story to distribution lists and groups, as Web A's composer does: a text story on one of the preset
 * backgrounds, or a photo or video, which the provider uploads from a URL of this worker
 */
export async function sendStory(host: SignalMethodHost, story: SignalNewStory, listIds: string[], groupIds: string[]) {
  const {file, width, height} = story;
  const blobUrl = file && URL.createObjectURL(file);
  try {
    return await host.call<true | undefined>('sendStory', {
      story: {
        text: story.text ? {text: story.text} : undefined,
        textStyle: story.textStyle,
        backgroundIndex: story.backgroundIndex,
        attachment: file ? {
          blobUrl,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          quick: width && height ? {width, height} : undefined
        } : undefined,
        caption: story.caption ? {text: story.caption} : undefined
      },
      listIds,
      groupIds
    });
  } finally {
    if(blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

/** Deletes our stories for everyone who has them; a delete that does not reach everyone still deletes it here */
async function deleteStories(host: SignalMethodHost, inputPeer: any, ids: number[]) {
  const peer = getPeerRef(host, inputPeer);
  const deleted: number[] = [];
  for(const storyId of ids) {
    const result = peer && await host.call<{isPartial?: true} | undefined>('deleteStory', {peer, storyId});
    if(result) deleted.push(storyId);
  }

  if(deleted.length !== ids.length) throw makeError('STORY_DELETE_FAILED' as ErrorType);
  return deleted;
}

async function togglePeerStoriesHidden(host: SignalMethodHost, params: MethodDeclMap['stories.togglePeerStoriesHidden']['req']) {
  const peer = getPeerRef(host, params.peer);
  const result = peer && await host.call<true | undefined>('toggleStoriesHidden', {peer, isHidden: params.hidden});
  if(!result) throw makeError('PEER_ID_INVALID' as ErrorType);
  return true;
}

function getPeerRef(host: SignalMethodHost, inputPeer: any): PeerRef | undefined {
  const peerId = host.getInputPeerId(inputPeer);
  return peerId ? {id: toSignalPeerId(peerId)} : undefined;
}

/** The users and groups of the stories, as Web K holds them: the provider sends them before its answers */
function getPeers(host: SignalMethodHost, peerStories: PeerStories[]) {
  const {appPeersManager} = host.getManagers();
  const users: User[] = [];
  const chats: Chat[] = [];
  const add = (peerId: PeerId) => {
    const peer = appPeersManager.getPeer(peerId);
    if(!peer) return;
    if(peerId < 0) {
      if(!chats.includes(peer as Chat)) chats.push(peer as Chat);
    } else if(!users.includes(peer as User)) {
      users.push(peer as User);
    }
  };

  peerStories.forEach(({peer, stories}) => {
    add(appPeersManager.getPeerId(peer));
    stories.forEach((story) => {
      const fromId = (story as StoryItem.storyItem).from_id;
      if(fromId) add(appPeersManager.getPeerId(fromId));
    });
  });

  return {users, chats};
}

function buildPeerStories(signalPeerId: string, {byId, orderedIds, lastReadId}: SignalPeerStories): PeerStories.peerStories {
  return {
    _: 'peerStories',
    peer: buildPeer(signalPeerId),
    max_read_id: lastReadId ?? 0,
    stories: orderedIds.map((id) => byId[id]).filter(Boolean).map(buildStoryItem)
  };
}

export function buildStoryItem(story: SignalTypeStory): StoryItem {
  if(story['@type'] === 'storyDeleted' || story['@type'] === 'storySkipped' || !('content' in story)) {
    return {_: 'storyItemDeleted', id: story.id};
  }

  const {content, textStory} = story as SignalStory;
  const item: SignalStoryItem = {
    _: 'storyItem',
    pFlags: {
      out: story.isOut,
      // * Signal stories cannot be forwarded, shared or saved from here
      noforwards: true
    },
    id: story.id,
    date: story.date,
    expire_date: story.expireDate,
    from_id: story.fromId ? buildPeer(story.fromId) : undefined,
    caption: content.text?.text,
    entities: content.text?.entities?.map(buildEntity).filter(Boolean),
    media: buildStoryMedia(content, story.date),
    views: story.views ? buildStoryViews(story.views) : undefined,
    sent_reaction: story.sentReaction ? buildReaction(story.sentReaction) : undefined,
    signal_text_story: textStory,
    signal_no_replies: story.noReplies
  };
  return item;
}

function buildStoryViews(views: SignalStoryViews): StoryViews.storyViews {
  return {
    _: 'storyViews',
    pFlags: {has_viewers: views.hasViewers},
    views_count: views.viewsCount ?? 0,
    reactions_count: views.reactionsCount ?? 0,
    recent_viewers: views.recentViewerIds?.map(toPeerId)
  };
}

/** A view of our story with its viewer's reaction, or a reaction of someone whose view was not received */
function buildStoryView(view: SignalStoryView): StoryView.storyView | undefined {
  if(view.type !== 'user' && !(view.type === 'reply' && view.reaction && !view.text)) {
    return undefined;
  }

  return {
    _: 'storyView',
    pFlags: {},
    user_id: toPeerId(view.peerId),
    date: view.date,
    reaction: view.reaction ? buildReaction(view.reaction) : undefined
  };
}

/**
 * A photo or a video story. A text story (`signal_text_story`) has no media of Telegram's: it is media Web K does not
 * show, which the story viewer draws as the text story instead
 */
function buildStoryMedia(content: SignalStory['content'], date: number): MessageMedia {
  if(content.photo) return {_: 'messageMediaPhoto', pFlags: {}, photo: buildStoryPhoto(content.photo)};
  if(content.video) {
    return {_: 'messageMediaDocument', pFlags: {video: true}, document: buildStoryVideo(content.video, date)};
  }

  return {_: 'messageMediaUnsupported'};
}

function buildStoryPhoto(photo: SignalStoryPhoto) {
  const size = photo.size ?? 0;
  return {
    _: 'photo' as const,
    pFlags: {},
    id: photo.id,
    access_hash: '0',
    file_reference: new Uint8Array(),
    date: photo.date,
    sizes: photo.sizes.length ?
      photo.sizes.map(({width, height}) => ({_: 'photoSize' as const, type: PHOTO_SIZE_TYPE, w: width, h: height, size})) :
      [{_: 'photoSize' as const, type: PHOTO_SIZE_TYPE, w: 0, h: 0, size}],
    dc_id: DC_ID
  };
}

function buildStoryVideo(video: SignalStoryVideo, date: number) {
  return {
    _: 'document' as const,
    pFlags: {},
    id: video.id,
    access_hash: '0',
    file_reference: new Uint8Array(),
    date,
    dc_id: DC_ID,
    mime_type: video.mimeType as MTMimeType,
    size: video.size,
    attributes: [
      {
        _: 'documentAttributeVideo' as const,
        pFlags: {supports_streaming: true as const},
        duration: video.duration,
        w: video.width ?? 0,
        h: video.height ?? 0
      },
      {_: 'documentAttributeFilename' as const, file_name: video.fileName}
    ],
    thumbs: video.thumbnail ? [{
      _: 'photoSize' as const,
      type: THUMBNAIL_SIZE_TYPE,
      w: video.thumbnail.width,
      h: video.thumbnail.height,
      size: 0
    }] : undefined
  };
}
