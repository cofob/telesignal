import { fromBinary } from '@bufbuild/protobuf';

import type { ConversationRecord, MessageRecord, SendStatus } from '../../../lib/signal/db/MessageDb';
import type { GroupUpdate } from '../../../lib/signal/groups/groupUpdates';
import type {
  BodyRange, DataMessage, DataMessage_Contact, DataMessage_PollCreate, DataMessage_Quote, DataMessage_StoryContext,
} from '../../../lib/signal/proto/generated/SignalService_pb';
import type {
  ApiMessage,
  ApiMessagePoll,
  ApiPeerReaction,
  ApiPollResult,
  ApiReactionCount,
  ApiReactions,
  ApiReplyInfo,
  ApiUser,
  ApiWebPageFull,
  MediaContent,
} from '../../types';
import type { ApiMessageAction, ApiMessageActionGroupUpdate } from '../../types/messageActions';
import type { MentionedUser } from './bodyRanges';

import { getActivePinnedMessages } from '../../../lib/signal/messages/pinnedMessages';
import { getMessageSendState } from '../../../lib/signal/messages/sendState';
import {
  DataMessage_Payment_Activation_Type, DataMessageSchema,
} from '../../../lib/signal/proto/generated/SignalService_pb';
import { uuidToString } from '../../../lib/signal/serviceId';
import { getEmojiOnlyCountForMessage } from '../../../global/helpers/getEmojiOnlyCountForMessage';
import { omitUndefined } from '../../../util/iteratees';
import { getCurrentAccount } from '../client';
import { db, processor } from '../engine';
import { getPeerId } from '../peers';
import { buildApiFormattedText, getMentionAci } from './bodyRanges';
import { getCallOutcome } from './calls';
import { buildMessageMedia, buildWebPage } from './media';
import { buildApiUser } from './users';

export type UserResolver = ReturnType<typeof createUserResolver>;

const MS_PER_SECOND = 1000;
const INVITE_LINK_UPDATES = {
  on: 'linkOn',
  onWithApproval: 'linkOnWithApproval',
  off: 'linkOff',
  reset: 'linkReset',
} as const;
const ACCESS_UPDATES = {
  info: 'infoAccess',
  members: 'membersAccess',
  memberLabel: 'labelAccess',
} as const;
const DELIVERED_STATUSES = new Set<SendStatus>(['delivered', 'read', 'viewed']);
const UUID_BYTE_LENGTH = 16;
const NON_DIGIT_REGEX = /\D/g;

/** Builds the app message of a stored Signal message; `conversation` is the one it belongs to */
export async function buildApiMessage(message: MessageRecord, conversation: ConversationRecord): Promise<ApiMessage> {
  return (await buildApiMessageWithPoll(message, conversation, createUserResolver())).message;
}

/**
 * Builds the app message and, for polls, its poll, and for link previews, its web page. `users` resolves the people
 * the message refers to (sender, mentions, reactions, votes, shared contacts), so callers can send those users along.
 */
export async function buildApiMessageWithPoll(
  message: MessageRecord, conversation: ConversationRecord, users: UserResolver,
): Promise<{ message: ApiMessage; poll?: ApiMessagePoll; webPage?: ApiWebPageFull }> {
  const selfAci = getCurrentAccount()?.aci;
  const senderAci = message.authorAci || message.actorAci;
  const base = {
    id: message.id,
    chatId: getPeerId(conversation),
    date: convertToSeconds(message.sentAt),
    isOutgoing: message.isOutgoing,
    senderId: senderAci ? await users.getUserId(senderAci) : undefined,
  } satisfies Partial<ApiMessage>;

  if (message.kind === 'timerUpdate') {
    return {
      message: {
        ...base,
        content: { action: { mediaType: 'action', type: 'setMessagesTtl', period: message.expireTimer ?? 0 } },
      },
    };
  }
  if (message.kind === 'safetyNumberChange') {
    return { message: { ...base, content: { action: { mediaType: 'action', type: 'safetyNumberChange' } } } };
  }
  if (message.kind === 'verifiedChange') {
    return {
      message: {
        ...base,
        content: {
          action: {
            mediaType: 'action',
            type: 'safetyNumberVerified',
            isVerified: message.isVerified || undefined,
            isFromOtherDevice: message.isFromOtherDevice || undefined,
          },
        },
      },
    };
  }
  if (message.kind === 'groupUpdate' && message.groupUpdate) {
    const { action, senderAci: speakerAci } = await buildGroupUpdateAction(message.groupUpdate, conversation, users);
    return {
      message: {
        ...base,
        senderId: speakerAci ? await users.getUserId(speakerAci) : base.senderId,
        isOutgoing: speakerAci ? speakerAci === selfAci : base.isOutgoing,
        content: { action },
      },
    };
  }
  if (message.kind === 'call') {
    const call = message.callId ? await db.getCall(conversation.id, message.callId) : undefined;
    if (!call) return { message: { ...base, content: {} } };
    return {
      message: {
        ...base,
        content: {
          action: {
            mediaType: 'action', type: 'signalCall', callType: call.type, outcome: getCallOutcome(call),
          },
        },
      },
    };
  }
  if (message.kind !== 'message') {
    return { message: { ...base, content: { action: { mediaType: 'action', type: 'unsupported' } } } };
  }
  if (message.deletedAt) {
    const adminId = message.deletedByAdminAci ? await users.getUserId(message.deletedByAdminAci) : undefined;
    return { message: { ...base, content: { action: { mediaType: 'action', type: 'deleted', adminId } } } };
  }
  if (message.isViewOnceOpened) {
    return {
      message: { ...base, content: { action: { mediaType: 'action', type: 'viewOnce', isViewed: true } } },
    };
  }
  // Hidden from the history, see `getIsMessageHidden`
  if (!message.dataMessage) return { message: { ...base, content: {} } };

  const dataMessage = fromBinary(DataMessageSchema, message.dataMessage);
  const media = buildMessageMedia(message, dataMessage);
  if (media.contact) media.contact = { ...media.contact, ...await resolveContact(dataMessage.contact[0], users) };
  // View-once media stays out of the chat and opens once in the media viewer; outgoing media cannot be opened,
  // as in Signal Desktop
  if (dataMessage.isViewOnce) {
    const viewOnceMedia = message.isOutgoing ? undefined : media.photo ?? media.video;
    return {
      message: { ...base, content: { action: { mediaType: 'action', type: 'viewOnce', media: viewOnceMedia } } },
    };
  }
  const mentionedUsers = await resolveMentionedUsers(dataMessage.bodyRanges, users);
  const poll = dataMessage.pollCreate
    ? await buildApiPoll(message, dataMessage.pollCreate, selfAci, users)
    : undefined;
  const { body, bodyRanges, storyContext, reaction } = dataMessage;
  const webPage = !Object.keys(media).length ? buildWebPage(message, dataMessage) : undefined;
  // A reaction to a story shows as its emoji, replying to the story (Signal Desktop "Reacted to a story")
  const storyReaction = storyContext && reaction?.emoji ? { text: reaction.emoji } : undefined;
  const content: MediaContent = omitUndefined({
    ...media,
    text: body ? buildApiFormattedText(body, bodyRanges, mentionedUsers) : storyReaction,
    pollId: poll?.summary.id,
    webPage: webPage && { id: webPage.id },
  });
  if (content.text) content.text.emojiOnlyCount = getEmojiOnlyCountForMessage(content);
  // Gift badges, payments and other content without a counterpart in the app
  if (!Object.keys(content).length) content.action = buildNoticeAction(dataMessage);

  const isMentioned = Boolean(selfAci) && dataMessage.bodyRanges.some((range) => getMentionAci(range) === selfAci);
  const hasViewableMedia = Boolean(content.voice || content.video?.isRound);
  return {
    message: {
      ...base,
      content,
      replyInfo: storyContext
        ? await buildStoryReplyInfo(storyContext, users)
        : dataMessage.quote && await buildReplyInfo(dataMessage.quote, message, users),
      isEdited: message.editedAt ? true : undefined,
      editDate: message.editedAt ? convertToSeconds(message.editedAt) : undefined,
      reactions: await buildApiReactions(message, selfAci, users),
      ...getSendingFields(message, conversation),
      isDelivered: getIsDelivered(message) || undefined,
      ttlPeriod: message.expiresAt ? Math.round(message.expiresAt / MS_PER_SECOND) - base.date : undefined,
      isMentioned: isMentioned || undefined,
      hasUnreadMention: isMentioned && !message.readAt ? true : undefined,
      isMediaUnread: !message.isOutgoing && !message.viewedAt && hasViewableMedia ? true : undefined,
      isPinned: getActivePinnedMessages(conversation, Date.now()).some(({ messageId }) => messageId === message.id)
        || undefined,
      isForwardingAllowed: true,
    },
    poll,
    webPage,
  };
}

/**
 * What the app shows for a message without text, media or poll: the notice of a gift badge or a payment, as Signal
 * Desktop shows them when it cannot act on them (`#renderGiftBadge` in `ts/components/conversation/Message.dom.tsx`,
 * `PaymentEventNotification`), else the unsupported message notice
 */
function buildNoticeAction({ giftBadge, payment }: DataMessage): ApiMessageAction {
  if (giftBadge) return { mediaType: 'action', type: 'giftBadge' };
  if (payment?.Item.case === 'notification') {
    return { mediaType: 'action', type: 'payment', paymentType: 'notification' };
  }
  if (payment?.Item.case === 'activation') {
    const isActivated = payment.Item.value.type === DataMessage_Payment_Activation_Type.ACTIVATED;
    return { mediaType: 'action', type: 'payment', paymentType: isActivated ? 'activated' : 'activationRequest' };
  }
  return { mediaType: 'action', type: 'unsupported' };
}

/**
 * The service message of a group notice. Notices with a Telegram counterpart use it; `senderAci` replaces the
 * actor when the notice reads as said by someone else, such as an approved join request.
 */
async function buildGroupUpdateAction(
  update: GroupUpdate, conversation: ConversationRecord, users: UserResolver,
): Promise<{ action: ApiMessageAction; senderAci?: string }> {
  const groupAction = (fields: Omit<ApiMessageActionGroupUpdate, 'mediaType' | 'type'>) => ({
    action: { mediaType: 'action' as const, type: 'groupUpdate' as const, ...fields },
  });

  switch (update.type) {
    case 'create':
      return { action: { mediaType: 'action', type: 'chatCreate', title: conversation.title ?? '', userIds: [] } };
    case 'title':
      return { action: { mediaType: 'action', type: 'chatEditTitle', title: update.title ?? '' } };
    case 'avatar':
      return { action: { mediaType: 'action', type: update.isRemoved ? 'chatDeletePhoto' : 'chatEditPhoto' } };
    case 'description':
      return groupAction({ update: update.isRemoved ? 'descriptionRemoved' : 'description' });
    case 'membersAdded':
      if (update.isFromInviteLink) {
        return {
          action: { mediaType: 'action', type: 'chatJoinedByLink', inviterId: await users.getUserId(update.acis[0]) },
        };
      }
      return {
        action: {
          mediaType: 'action',
          type: 'chatAddUser',
          userIds: await Promise.all(update.acis.map((aci) => users.getUserId(aci))),
        },
      };
    case 'memberRemoved':
      return { action: { mediaType: 'action', type: 'chatDeleteUser', userId: await users.getUserId(update.aci) } };
    case 'joinApproved':
      return { action: { mediaType: 'action', type: 'chatJoinedByRequest' }, senderAci: update.aci };
    case 'joinRequested':
      return groupAction({ update: 'joinRequested' });
    case 'invited':
      return groupAction({ update: 'invited', count: update.count });
    case 'inviteRevoked':
      return groupAction({ update: 'inviteRevoked', count: update.count });
    case 'inviteDeclined':
      return groupAction({ update: 'inviteDeclined' });
    case 'joinDenied':
      return groupAction({ update: 'joinDenied', userId: await users.getUserId(update.aci) });
    case 'joinCanceled':
      return groupAction({ update: 'joinCanceled' });
    case 'adminChanged':
      return groupAction({
        update: update.isAdmin ? 'adminAdded' : 'adminRemoved', userId: await users.getUserId(update.aci),
      });
    case 'access':
      return groupAction({ update: ACCESS_UPDATES[update.target], isAdminOnly: update.isAdminOnly });
    case 'inviteLink':
      return groupAction({ update: INVITE_LINK_UPDATES[update.state] });
    case 'announcementsOnly':
      return groupAction({ update: update.isEnabled ? 'announcementsOn' : 'announcementsOff' });
    case 'terminated':
      return groupAction({ update: 'terminated' });
    default:
      return { action: { mediaType: 'action', type: 'unsupported' } };
  }
}

/**
 * Messages without content that the history leaves out. Remote deletes and opened view-once messages also
 * lose their content, but stay as placeholders, as in Signal.
 */
export function getIsMessageHidden(message: MessageRecord) {
  return message.kind === 'message' && !message.dataMessage && !message.deletedAt && !message.isViewOnceOpened;
}

/** Resolves users by ACI once for messages built together; users seen only in groups get a private conversation */
export function createUserResolver() {
  const selfAci = getCurrentAccount()?.aci ?? '';
  const conversations = new Map<string, Promise<ConversationRecord>>();

  function getConversation(aci: string) {
    let conversation = conversations.get(aci);
    if (!conversation) {
      conversation = processor.getOrCreatePrivateConversation(aci);
      conversations.set(aci, conversation);
    }
    return conversation;
  }

  return {
    async getUserId(aci: string) {
      return getPeerId(await getConversation(aci));
    },
    async getUser(aci: string) {
      return buildApiUser(await getConversation(aci), selfAci);
    },
    /** Every user resolved so far */
    async buildUsers(): Promise<ApiUser[]> {
      return Promise.all([...conversations.values()].map(async (conversation) => (
        buildApiUser(await conversation, selfAci)
      )));
    },
  };
}

/**
 * How to message a shared contact (Signal Desktop `resolveSharedContact` in `ts/util/sharedContact.std.ts`): the
 * existing chat with its ACI or one of its numbers, or its ACI, which gets a chat only when messaged
 */
async function resolveContact(
  { aciBinary, number }: DataMessage_Contact, users: UserResolver,
): Promise<{ userId?: string; aci?: string }> {
  if (aciBinary.length === UUID_BYTE_LENGTH) {
    const aci = uuidToString(aciBinary);
    return await db.getConversation(aci) ? { userId: await users.getUserId(aci) } : { aci };
  }

  const e164s = new Set(number.map(({ value }) => `+${value.replace(NON_DIGIT_REGEX, '')}`));
  if (!e164s.size) return {};
  const conversation = (await db.getConversations()).find(({ type, e164 }) => (
    type === 'private' && e164 && e164s.has(e164)
  ));
  return conversation ? { userId: await users.getUserId(conversation.id) } : {};
}

export async function resolveMentionedUsers(bodyRanges: BodyRange[], users: UserResolver) {
  const mentionedUsers = new Map<string, MentionedUser>();
  for (const range of bodyRanges) {
    const aci = getMentionAci(range);
    if (!aci || mentionedUsers.has(aci)) continue;
    const { id, firstName, lastName } = await users.getUser(aci);
    mentionedUsers.set(aci, { userId: id, name: [firstName, lastName].filter(Boolean).join(' ') });
  }
  return mentionedUsers;
}

/**
 * A quote names its message by author and timestamp. A message found in the same conversation becomes
 * a regular reply; otherwise the reply shows the author and the text the quote carries, unless the quoted
 * message was deleted.
 */
async function buildReplyInfo(
  quote: DataMessage_Quote, message: MessageRecord, users: UserResolver,
): Promise<ApiReplyInfo> {
  const authorAci = quote.authorAci || (quote.authorAciBinary.length ? uuidToString(quote.authorAciBinary) : '');
  const sentAt = Number(quote.id);
  const target = authorAci ? await db.findMessage(authorAci, sentAt) : undefined;
  const isTargetDeleted = Boolean(target && !target.dataMessage);
  if (target && target.conversationId === message.conversationId && !isTargetDeleted) {
    return { type: 'message', replyToMsgId: target.id };
  }

  const hasText = Boolean(quote.text) && !isTargetDeleted;
  return {
    type: 'message',
    replyFrom: authorAci ? {
      date: convertToSeconds(sentAt),
      isChannelPost: false,
      fromId: await users.getUserId(authorAci),
    } : undefined,
    quoteText: hasText
      ? buildApiFormattedText(quote.text, quote.bodyRanges, await resolveMentionedUsers(quote.bodyRanges, users))
      : undefined,
    isQuote: hasText || undefined,
  };
}

/** A reply to a story names the story; an expired one is not found and shows as such */
async function buildStoryReplyInfo(storyContext: DataMessage_StoryContext, users: UserResolver): Promise<ApiReplyInfo> {
  const authorAci = storyContext.authorAci
    || (storyContext.authorAciBinary.length ? uuidToString(storyContext.authorAciBinary) : '');
  const story = authorAci ? await db.findStory(authorAci, Number(storyContext.sentTimestamp)) : undefined;
  const conversation = story && await db.getConversation(story.conversationId);
  return {
    type: 'story',
    peerId: conversation ? getPeerId(conversation) : await users.getUserId(authorAci),
    storyId: story?.id ?? 0,
  };
}

async function buildApiReactions(
  message: MessageRecord, selfAci: string | undefined, users: UserResolver,
): Promise<ApiReactions | undefined> {
  if (!message.reactions?.length) return undefined;

  const results: ApiReactionCount[] = [];
  const recentReactions: ApiPeerReaction[] = [];
  for (const { emoji, authorAci, sentAt } of message.reactions) {
    const reaction = { type: 'emoji', emoticon: emoji } as const;
    const isOwn = authorAci === selfAci;
    let result = results.find((current) => current.reaction.type === 'emoji' && current.reaction.emoticon === emoji);
    if (!result) {
      result = { reaction, count: 0 };
      results.push(result);
    }
    result.count++;
    if (isOwn) result.chosenOrder = 0;
    recentReactions.push({
      peerId: await users.getUserId(authorAci),
      reaction,
      addedDate: convertToSeconds(sentAt),
      isOwn: isOwn || undefined,
    });
  }

  return {
    canSeeList: true,
    results: results.sort((a, b) => b.count - a.count),
    recentReactions: recentReactions.sort((a, b) => b.addedDate - a.addedDate),
  };
}

/** Signal polls show who voted; options are identified by their index */
async function buildApiPoll(
  message: MessageRecord, pollCreate: DataMessage_PollCreate, selfAci: string | undefined, users: UserResolver,
): Promise<ApiMessagePoll> {
  const votes = (message.pollVotes ?? []).filter(({ optionIndexes }) => optionIndexes.length);
  const resultByOption: Record<string, ApiPollResult> = {};
  for (const index of pollCreate.options.keys()) {
    const option = String(index);
    const voters = votes.filter(({ optionIndexes }) => optionIndexes.includes(index));
    resultByOption[option] = {
      option,
      votersCount: voters.length,
      isChosen: voters.some(({ authorAci }) => authorAci === selfAci) || undefined,
      recentVoterIds: await Promise.all(voters.map(({ authorAci }) => users.getUserId(authorAci))),
    };
  }

  return {
    mediaType: 'poll',
    summary: {
      id: String(message.id),
      hash: '',
      isClosed: message.isPollEnded || undefined,
      isPublic: true,
      isMultipleChoice: pollCreate.allowMultiple || undefined,
      isCreator: message.isOutgoing || undefined,
      question: { text: pollCreate.question },
      answers: pollCreate.options.map((text, index) => ({ text: { text }, option: String(index) })),
    },
    results: {
      resultByOption,
      totalVoters: votes.length,
      recentVoterIds: await Promise.all(votes.map(({ authorAci }) => users.getUserId(authorAci))),
    },
  };
}

/** Pending, failed or partially sent, as Signal Desktop shows it (see `getMessageSendState`) */
function getSendingFields(message: MessageRecord, conversation: ConversationRecord) {
  const state = getMessageSendState(message, conversation);
  // The keys are always there, so that a stored message replaces the sending fields of its local message
  let sendingState: ApiMessage['sendingState'];
  if (state === 'pending') sendingState = 'messageSendingStatePending';
  if (state === 'failed') sendingState = 'messageSendingStateFailed';
  return { sendingState, isPartiallySent: state === 'partial' ? true as const : undefined };
}

/**
 * Like read checks (`getIsReadByRecipient`), delivered checks show the highest status any recipient reached,
 * as Signal Desktop `getMessagePropStatus` in `ts/state/selectors/message.preload.ts` does
 */
function getIsDelivered({ isOutgoing, recipientStatus }: MessageRecord) {
  return isOutgoing && Object.values(recipientStatus ?? {}).some((status) => DELIVERED_STATUSES.has(status));
}

function convertToSeconds(timestamp: number) {
  return Math.floor(timestamp / MS_PER_SECOND);
}
