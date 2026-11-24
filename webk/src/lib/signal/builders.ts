/*
 * TeleSignal: the Web K shapes (`@layer`) of what the Signal provider returns (`@signal-app/provider`).
 * The provider's peer ids are small: a private conversation is the user `localId`, a group the basic group
 * `localId` (peer id `-localId`). Web K reads small ids as its own (folder ids, the service and reply peers), so its
 * ids are the provider's moved by `PEER_ID_OFFSET`. Message ids are the ids of the engine's message database, unique
 * across chats, as Telegram's ids of private chats and basic groups are.
 */

import type {
  Chat,
  ChatAdminRights,
  ChatBannedRights,
  Dialog,
  Message,
  MessageAction,
  MessageEntity,
  MessagePeerReaction,
  MessageReactions,
  MessageReplyHeader,
  Peer,
  PeerNotifySettings,
  User,
  UserProfilePhoto,
  ChatPhoto
} from '@layer';
import type {
  SignalChat,
  SignalEntity,
  SignalMessage,
  SignalNotifySettings,
  SignalReactions,
  SignalReadState,
  SignalRights,
  SignalUser
} from '@lib/signal/signalApi';
import {buildReaction} from '@lib/signal/reactions';
import {buildPollMedia} from '@lib/signal/polls';
import {buildSignalMessageMedia} from '@lib/signal/media';

// * Web A's `ARCHIVED_FOLDER_ID`, which Web K's folder of archived chats has too
const ARCHIVED_FOLDER_ID = 1;
const PEER_ID_OFFSET = 1e10;

/** Web K's peer id of a provider peer id */
export function toPeerId(signalPeerId: string | number): PeerId {
  const id = +signalPeerId;
  return (id < 0 ? id - PEER_ID_OFFSET : id + PEER_ID_OFFSET) as PeerId;
}

/** The provider's peer id of a Web K peer id */
export function toSignalPeerId(peerId: PeerId | string | number) {
  const id = +peerId;
  return '' + (id < 0 ? id + PEER_ID_OFFSET : id - PEER_ID_OFFSET);
}

export function isGroupPeerId(peerId: string | number) {
  return +peerId < 0;
}

export function buildPeer(signalPeerId: string | number): Peer {
  const id = toPeerId(signalPeerId);
  return id < 0 ? {_: 'peerChat', chat_id: -id} : {_: 'peerUser', user_id: id};
}

export function buildUser(user: SignalUser): User.user {
  const username = user.usernames?.find(({isActive}) => isActive)?.username;
  return {
    _: 'user',
    pFlags: {
      self: user.isSelf,
      contact: user.isContact
    },
    id: toPeerId(user.id),
    access_hash: '0',
    first_name: user.firstName,
    last_name: user.lastName,
    phone: user.phoneNumber || undefined,
    username,
    photo: buildUserPhoto(user.avatarPhotoId),
    status: {_: 'userStatusEmpty'},
    color: user.color?.color !== undefined ? {_: 'peerColor', color: user.color.color} : undefined
  };
}

// * the provider's rights of a group (`ApiChatAdminRights`, `ApiChatBannedRights`) under Telegram's flag names
const ADMIN_RIGHT_FLAGS: Record<string, keyof ChatAdminRights.chatAdminRights['pFlags']> = {
  changeInfo: 'change_info',
  postMessages: 'post_messages',
  editMessages: 'edit_messages',
  deleteMessages: 'delete_messages',
  banUsers: 'ban_users',
  inviteUsers: 'invite_users',
  pinMessages: 'pin_messages',
  addAdmins: 'add_admins',
  manageRanks: 'manage_ranks'
};
const BANNED_RIGHT_FLAGS: Record<string, keyof ChatBannedRights.chatBannedRights['pFlags']> = {
  viewMessages: 'view_messages',
  // * Web K's "Send Messages" permission is `send_plain`
  sendMessages: 'send_plain',
  sendMedia: 'send_media',
  sendStickers: 'send_stickers',
  sendGifs: 'send_gifs',
  sendGames: 'send_games',
  sendInline: 'send_inline',
  embedLinks: 'embed_links',
  sendPolls: 'send_polls',
  changeInfo: 'change_info',
  inviteUsers: 'invite_users',
  pinMessages: 'pin_messages',
  editRank: 'edit_rank'
};

/**
 * The rights of ours in a group, which Web K reads to show the group's members and settings. Telegram's basic
 * groups always have default banned rights, so an empty set is a set of its own: a group without them hides its
 * members from Web K.
 */
function buildAdminRights(rights?: SignalRights): ChatAdminRights.chatAdminRights | undefined {
  if(!rights) return undefined;
  const pFlags: ChatAdminRights.chatAdminRights['pFlags'] = {};
  Object.entries(ADMIN_RIGHT_FLAGS).forEach(([name, flag]) => {
    if(rights[name]) pFlags[flag] = true;
  });
  return {_: 'chatAdminRights', pFlags};
}

function buildBannedRights(rights?: SignalRights): ChatBannedRights.chatBannedRights {
  const pFlags: ChatBannedRights.chatBannedRights['pFlags'] = {};
  Object.entries(BANNED_RIGHT_FLAGS).forEach(([name, flag]) => {
    if(rights?.[name]) pFlags[flag] = true;
  });
  return {_: 'chatBannedRights', pFlags, until_date: 0};
}

/** Groups only: a private conversation is its user (`buildUser`) */
export function buildChat(chat: SignalChat): Chat.chat {
  return {
    _: 'chat',
    pFlags: {
      creator: chat.isOwner || undefined,
      left: chat.isForbidden || undefined
    },
    id: -toPeerId(chat.id),
    title: chat.title,
    photo: buildChatPhoto(chat.avatarPhotoId),
    participants_count: chat.membersCount || 0,
    date: chat.creationDate || 0,
    version: 0,
    admin_rights: buildAdminRights(chat.adminRights),
    default_banned_rights: buildBannedRights(chat.defaultBannedRights)
  };
}

export function buildDialog({chat, readState, topMessageId, notifySettings, isPinned}: {
  chat: SignalChat,
  readState?: SignalReadState,
  topMessageId?: number,
  notifySettings?: SignalNotifySettings,
  isPinned?: boolean
}): Dialog.dialog {
  return {
    _: 'dialog',
    pFlags: {
      pinned: isPinned || undefined,
      unread_mark: readState?.hasUnreadMark || undefined
    },
    peer: buildPeer(chat.id),
    top_message: topMessageId || 0,
    read_inbox_max_id: readState?.lastReadInboxMessageId || 0,
    read_outbox_max_id: readState?.lastReadOutboxMessageId || 0,
    unread_count: readState?.unreadCount || 0,
    unread_mentions_count: 0,
    unread_reactions_count: 0,
    unread_poll_votes_count: 0,
    notify_settings: buildNotifySettings(notifySettings),
    folder_id: chat.folderId === ARCHIVED_FOLDER_ID ? 1 : 0,
    ttl_period: chat.ttlPeriod
  };
}

export function buildNotifySettings(settings?: SignalNotifySettings): PeerNotifySettings.peerNotifySettings {
  return {
    _: 'peerNotifySettings',
    mute_until: settings?.mutedUntil,
    show_previews: settings?.shouldShowPreviews
  };
}

export function buildMessage(message: SignalMessage, getName: SignalNameResolver = () => ''): Message.message | Message.messageService {
  const peerId = buildPeer(message.chatId);
  const fromId = message.senderId ? buildPeer(message.senderId) : undefined;
  const pFlags: Message.message['pFlags'] = {
    out: message.isOutgoing || undefined,
    pinned: message.isPinned || undefined
  };

  const {action} = message.content;
  const viewOnceMedia = action?.type === 'viewOnce' ? buildViewOnceMedia(action.media, message.date) : undefined;
  if(viewOnceMedia) {
    // * view-once media that is not opened yet: Web K's self-destructing media, which it shows as a service line
    // * with a button that opens it once, and which cannot be forwarded, saved or copied
    return {
      _: 'message',
      pFlags: {...pFlags, noforwards: true},
      id: message.id,
      peer_id: peerId,
      from_id: fromId,
      date: message.date,
      message: '',
      media: viewOnceMedia
    };
  }

  if(action) {
    return {
      _: 'messageService',
      pFlags,
      id: message.id,
      peer_id: peerId,
      from_id: fromId,
      date: message.date,
      action: buildMessageAction(message, getName),
      // * a pin notice names the pinned message as Telegram's does
      reply_to: buildReplyHeader(message.replyInfo)
    };
  }

  const {text} = message.content;
  return {
    _: 'message',
    pFlags,
    id: message.id,
    peer_id: peerId,
    from_id: fromId,
    date: message.date,
    message: text?.text || '',
    entities: text?.entities?.map(buildEntity).filter(Boolean),
    media: buildSignalMessageMedia(message.content, message.date) ??
      (message.content.pollId ? buildPollMedia(message.content.pollId) ?? {_: 'messageMediaUnsupported'} : undefined),
    reply_to: buildReplyHeader(message.replyInfo),
    reactions: message.reactions ? buildMessageReactions(message.reactions) : undefined,
    edit_date: message.isEdited ? message.editDate || message.date : undefined,
    ttl_period: message.ttlPeriod,
    grouped_id: message.groupedId,
    // * Web K shows a message with an error as failed, as it does a send of its own that failed
    error: message.sendingState === 'messageSendingStateFailed' ? {type: 'SIGNAL_SEND_FAILED' as ErrorType, code: 400} : undefined
  };
}

// * Telegram's view-once media keeps its `ttl_seconds` at this value
const VIEW_ONCE_TTL_SECONDS = 0x7FFFFFFF;

/** The media of an unopened view-once message, as Web K's self-destructing photo or video */
function buildViewOnceMedia(media: any, date: number) {
  const built = media && buildSignalMessageMedia({[media.mediaType]: media} as SignalMessage['content'], date);
  if(built?._ !== 'messageMediaPhoto' && built?._ !== 'messageMediaDocument') return undefined;
  return {...built, ttl_seconds: VIEW_ONCE_TTL_SECONDS};
}

// * a reply to a message of the chat names it; a quote of a message that is not in the chat, or is gone, keeps the
// * text the quote carries
function buildReplyHeader(replyInfo: SignalMessage['replyInfo']): MessageReplyHeader.messageReplyHeader | undefined {
  if(replyInfo?.replyToMsgId) {
    return {_: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: replyInfo.replyToMsgId};
  }

  if(!replyInfo?.quoteText) return undefined;
  const {replyFrom, quoteText} = replyInfo;
  return {
    _: 'messageReplyHeader',
    pFlags: {quote: true},
    reply_from: replyFrom ? {_: 'messageFwdHeader', pFlags: {}, from_id: buildPeer(replyFrom.fromId), date: replyFrom.date} : undefined,
    quote_text: quoteText.text,
    quote_entities: quoteText.entities?.map(buildEntity).filter(Boolean)
  };
}

export function buildMessageReactions(reactions: SignalReactions): MessageReactions {
  return {
    _: 'messageReactions',
    pFlags: {can_see_list: reactions.canSeeList || undefined},
    results: reactions.results.map(({chosenOrder, count, reaction}) => ({
      _: 'reactionCount',
      chosen_order: chosenOrder,
      reaction: buildReaction(reaction),
      count
    })),
    recent_reactions: reactions.recentReactions?.map(buildPeerReaction)
  };
}

export function buildPeerReaction({peerId, reaction, isOwn, addedDate}: NonNullable<SignalReactions['recentReactions']>[number]): MessagePeerReaction {
  return {
    _: 'messagePeerReaction',
    pFlags: {my: isOwn || undefined},
    peer_id: buildPeer(peerId),
    date: addedDate,
    reaction: buildReaction(reaction)
  };
}

// * Web A's `ApiMessageEntityTypes` are the TL names with an upper-case first letter
function buildEntity(entity: SignalEntity): MessageEntity {
  const {type, offset, length} = entity;
  const name = (type.charAt(0).toLowerCase() + type.slice(1)) as MessageEntity['_'];
  switch(name) {
    case 'messageEntityTextUrl':
      return {_: name, offset, length, url: entity.url};
    case 'messageEntityMentionName':
      return {_: name, offset, length, user_id: toPeerId(entity.userId)};
    case 'messageEntityPre':
      return {_: name, offset, length, language: entity.language || ''};
    case 'messageEntityBold':
    case 'messageEntityItalic':
    case 'messageEntityUnderline':
    case 'messageEntityStrike':
    case 'messageEntityCode':
    case 'messageEntitySpoiler':
    case 'messageEntityUrl':
    case 'messageEntityEmail':
    case 'messageEntityPhone':
    case 'messageEntityMention':
    case 'messageEntityHashtag':
      return {_: name, offset, length} as MessageEntity;
    default:
      return undefined;
  }
}

/** The name of a user of the provider, for the notices that Web K shows as text */
export type SignalNameResolver = (signalUserId: string) => string;

// * Web A's texts of the notices Telegram has not (`ActionMessageText.tsx` and `fallback.strings` there)
const GROUP_UPDATE_TEXTS: Record<string, [string, string]> = {
  description: ['{from} changed the group description', 'You changed the group description'],
  descriptionRemoved: ['{from} removed the group description', 'You removed the group description'],
  adminAdded: ['{from} made {user} an admin', 'You made {user} an admin'],
  adminRemoved: ['{from} revoked admin privileges from {user}', 'You revoked admin privileges from {user}'],
  inviteDeclined: ['{from} declined the invitation to the group', 'You declined the invitation to the group'],
  joinRequested: ['{from} requested to join via the group link', 'You sent a request to join the group'],
  joinDenied: ['{from} denied a request to join from {user}', 'You denied a request to join from {user}'],
  joinCanceled: ['{from} canceled the request to join', 'You canceled your request to join the group'],
  linkOn: ['{from} turned on the group link', 'You turned on the group link'],
  linkOnWithApproval: ['{from} turned on the group link with admin approval', 'You turned on the group link with admin approval'],
  linkOff: ['{from} turned off the group link', 'You turned off the group link'],
  linkReset: ['{from} reset the group link', 'You reset the group link'],
  infoAccess: ['{from} changed who can edit group info to «{access}»', 'You changed who can edit group info to «{access}»'],
  membersAccess: ['{from} changed who can add members to «{access}»', 'You changed who can add members to «{access}»'],
  labelAccess: ['{from} changed who can add member labels to «{access}»', 'You changed who can add member labels to «{access}»'],
  announcementsOn: ['{from} allowed only admins to send messages', 'You allowed only admins to send messages'],
  announcementsOff: ['{from} allowed all members to send messages', 'You allowed all members to send messages'],
  terminated: ['{from} ended the group', 'You ended the group'],
  invited: ['{from} invited {count} {people} to the group', 'You invited {count} {people} to the group'],
  inviteRevoked: ['{from} revoked {count} {invitations} to the group', 'You revoked {count} {invitations} to the group']
};

function buildMessageAction(message: SignalMessage, getName: SignalNameResolver): MessageAction {
  const action = message.content.action;
  switch(action.type) {
    case 'setMessagesTtl':
      return {_: 'messageActionSetMessagesTTL', period: (action.period as number) || 0};
    case 'chatCreate':
      return {_: 'messageActionChatCreate', title: (action.title as string) || '', users: []};
    case 'chatEditTitle':
      return {_: 'messageActionChatEditTitle', title: (action.title as string) || ''};
    case 'chatAddUser':
      return {_: 'messageActionChatAddUser', users: ((action.userIds as string[]) || []).map(toPeerId)};
    case 'chatDeleteUser':
      return {_: 'messageActionChatDeleteUser', user_id: toPeerId(action.userId as string)};
    case 'chatJoinedByLink':
      return {_: 'messageActionChatJoinedByLink', inviter_id: toPeerId(action.inviterId as string)};
    case 'chatJoinedByRequest':
      return {_: 'messageActionChatJoinedByRequest'};
    case 'pinMessage':
      return {_: 'messageActionPinMessage'};
    case 'signalCall':
      if(action.callType !== 'group') {
        return buildPhoneCallAction(action.callType === 'video', action.outcome as string);
      }
    default:
      // * the notices Signal has and Telegram has not (safety numbers, group access) show as text
      return {_: 'messageActionCustomAction', message: getActionText(message, getName)};
  }
}

// * Web K tells incoming from outgoing calls by the message, and missed or declined ones by the reason
export function buildPhoneCallAction(isVideo: boolean, outcome: string): MessageAction.messageActionPhoneCall {
  return {
    _: 'messageActionPhoneCall',
    pFlags: {video: isVideo || undefined},
    call_id: '0',
    reason: outcome === 'missed' ? {_: 'phoneCallDiscardReasonMissed'} : (
      outcome === 'declined' ? {_: 'phoneCallDiscardReasonBusy'} : {_: 'phoneCallDiscardReasonHangup'}
    )
  };
}

function getActionText(message: SignalMessage, getName: SignalNameResolver) {
  const {action} = message.content;
  const from = message.senderId ? getName(message.senderId) : '';
  const isOut = message.isOutgoing;
  switch(action.type) {
    case 'groupUpdate': {
      const texts = GROUP_UPDATE_TEXTS[action.update as string];
      if(!texts) return 'Group updated';
      const count = (action.count as number) || 0;
      return (isOut ? texts[1] : texts[0])
      .replace('{from}', from)
      .replace('{user}', action.userId ? getName(action.userId as string) : '')
      .replace('{access}', action.isAdminOnly ? 'Only admins' : 'All members')
      .replace('{count}', '' + count)
      .replace('{people}', count === 1 ? 'person' : 'people')
      .replace('{invitations}', count === 1 ? 'invitation' : 'invitations');
    }
    case 'safetyNumberChange':
      return `Your safety number with ${from} has changed`;
    case 'safetyNumberVerified': {
      const state = action.isVerified ? 'verified' : 'unverified';
      return `You marked your safety number with ${from} as ${state}${action.isFromOtherDevice ? ' from another device' : ''}`;
    }
    case 'signalCall':
      return action.outcome === 'missed' ? 'Missed group call' : 'Group call';
    case 'giftBadge':
      return isOut ?
        'You donated to Signal on behalf of this person. Tap this message on mobile to view your donation' :
        `${from} donated to Signal on your behalf. View this message on mobile to open it`;
    case 'payment':
      return isOut ? 'You sent a payment' : `${from} sent you a payment`;
    case 'deleted':
      return isOut ? 'You deleted this message' : `${from} deleted this message`;
    case 'viewOnce':
      return action.isViewed ? 'Viewed' : 'View-once media';
    default:
      return 'Unsupported message';
  }
}

function buildUserPhoto(avatarPhotoId?: string): UserProfilePhoto {
  return avatarPhotoId ? {
    _: 'userProfilePhoto',
    pFlags: {},
    photo_id: avatarPhotoId,
    dc_id: 0
  } : {_: 'userProfilePhotoEmpty'};
}

function buildChatPhoto(avatarPhotoId?: string): ChatPhoto {
  return avatarPhotoId ? {
    _: 'chatPhoto',
    pFlags: {},
    photo_id: avatarPhotoId,
    dc_id: 0
  } : {_: 'chatPhotoEmpty'};
}
