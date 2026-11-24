import type {
  ApiAttachment,
  ApiChat,
  ApiDraft,
  ApiError,
  ApiFactCheck,
  ApiInputDraftReplyInfo,
  ApiInputMessageReplyInfo,
  ApiInputReplyInfo,
  ApiInputRichMessage,
  ApiInputStoryReplyInfo,
  ApiMessage,
  ApiMessageEntity,
  ApiOnProgress,
  ApiSticker,
  ApiStory,
  ApiThreadInfo,
  ApiUser,
  ApiVideo,
  MediaContent,
} from '../../../api/types';
import type {
  ForwardMessagesParams,
  SendMessageParams,
  ThreadId,
} from '../../../types';
import type { MessageKey } from '../../../util/keys/messageKey';
import type { RequiredGlobalActions } from '../../index';
import type {
  ActionReturnType, GlobalState, TabArgs,
} from '../../types';
import { MAIN_THREAD_ID, MESSAGE_DELETED } from '../../../api/types';
import { LoadMoreDirection } from '../../../types';

import {
  GIF_MIME_TYPE,
  MAX_MEDIA_FILES_FOR_ALBUM,
  MESSAGE_LIST_SLICE,
  SUPPORTED_AUDIO_CONTENT_TYPES,
  SUPPORTED_PHOTO_CONTENT_TYPES,
  SUPPORTED_VIDEO_CONTENT_TYPES,
} from '../../../config';
import { revokeAttachmentUrls } from '../../../util/attachments';
import { ensureProtocol } from '../../../util/browser/url';
import { IS_IOS } from '../../../util/browser/windowEnvironment';
import buildUploadingMedia from '../../../util/buildUploadingMedia';
import { openSignalLink } from '../../../util/deeplink';
import { isDeepLink } from '../../../util/deepLinkParser';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import {
  areSortedArraysIntersecting,
  buildCollectionByKey,
  omit,
  partition,
  split,
  unique,
  uniqueByField,
} from '../../../util/iteratees';
import { getMessageKey, isLocalMessageId } from '../../../util/keys/messageKey';
import { getTranslationFn } from '../../../util/localization';
import { debounce, onTickEnd, rafPromise } from '../../../util/schedulers';
import { getServerTime } from '../../../util/serverTime';
import { parseSignalLink } from '../../../util/signalLinks';
import { cancelVideoAttachmentProcessing, processVideoAttachment } from '../../../util/videoProcessingQueue';
import { callApi, cancelApiProgress } from '../../../api';
import {
  getUserFullName,
  groupMessageIdsByThreadId,
  isDeletedUser,
  isEphemeralSendSupported,
  isMessageLocal,
  isUserRightBanned,
  runForFocusedTabs,
  splitMessagesForForwarding,
} from '../../helpers';
import {
  addActionHandler, getActions, getGlobal, getPromiseActions, setGlobal,
} from '../../index';
import { scheduleEphemeralExpiration } from '../../intervals';
import {
  addChatMessagesById,
  removeOutlyingList,
  removeUnreadMentions,
  replaceUserStatuses,
  safeReplacePinnedIds,
  safeReplaceViewportIds,
  updateChatMessage,
  updateEphemeralMessage,
  updateListedIds,
  updateOutlyingLists,
  updatePeerFullInfo,
  updateScheduledMessage,
  updateScheduledMessages,
  updateUploadByMessageKey,
} from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import {
  replaceThreadLocalStateParam,
  replaceThreadReadStateParam,
  updateThreadInfo,
  updateThreadInfoMessagesCount,
  updateThreadReadState,
} from '../../reducers/threads';
import {
  selectCanForwardMessage,
  selectCanForwardMessages,
  selectChat,
  selectChatFullInfo,
  selectChatLastMessageId,
  selectChatMessage,
  selectChatMessageOrEphemeral,
  selectChatMessages,
  selectCurrentChat,
  selectCurrentMessageList,
  selectCurrentViewedStory,
  selectCustomEmoji,
  selectEditingMessage,
  selectEphemeralMessage,
  selectFirstUnreadId,
  selectFocusedMessageId,
  selectForwardsCanBeSentToChat,
  selectForwardsContainVoiceMessages,
  selectIsChatRestricted,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectListedIds,
  selectMessageReplyInfo,
  selectOutlyingListByMessageId,
  selectPeerStory,
  selectPinnedIds,
  selectPollFromMessage,
  selectRealLastReadId,
  selectReplyCanBeSentToChat,
  selectScheduledMessage,
  selectTabState,
  selectUser,
  selectUserFullInfo,
  selectUserStatus,
  selectViewportIds,
} from '../../selectors';
import { selectPlaybackMedia } from '../../selectors/audioPlayer';
import {
  selectDraft,
  selectEditingId,
  selectEditingScheduledId,
  selectNoWebPage,
  selectThreadInfo,
  selectThreadLocalStateParam,
  selectThreadReadState,
} from '../../selectors/threads';
import {
  deleteEphemeralMessagesWithAnimation, deleteMessages,
} from '../apiUpdaters/messages';

type SendEphemeralMessagesParams = {
  chat: ApiChat;
  receiver: ApiUser;
  text?: string;
  entities?: ApiMessageEntity[];
  richMessage?: ApiInputRichMessage;
  replyInfo?: ApiInputReplyInfo;
  attachments?: ApiAttachment[];
  sticker?: ApiSticker;
  gif?: ApiVideo;
  topMsgId?: number;
  tabId?: number;
};

const AUTOLOGIN_TOKEN_KEY = 'autologin_token';

const SECOND_IN_MS = 1000;
// `setTimeout` overflows on delays over ~25 days, so long TTLs are awaited in day-long hops
const TTL_CLEANUP_MAX_DELAY = 24 * 60 * 60 * SECOND_IN_MS;
const TTL_CLEANUP_DELAY_BUFFER = SECOND_IN_MS;

const uploadProgressCallbacks = new Map<MessageKey, ApiOnProgress>();
const processedVideoMessageKeys = new Set<MessageKey>();
const VIDEO_PROCESSING_FAILED_ERROR = 'VIDEO_PROCESSING_FAILED';
const VIDEO_PROCESSING_PROGRESS_SHARE = 0.33;

const ttlCleanupTimersByChatId = new Map<string, { timer: number; expiresAt: number }>();
// Latest preview request per thread, so a slower older response can't overwrite a newer one or a clear
const webPagePreviewTokens = new Map<string, symbol>();

const runDebouncedForMarkRead = debounce((cb) => cb(), 500, false);

addActionHandler('loadViewportMessages', (global, actions, payload): ActionReturnType => {
  const {
    direction = LoadMoreDirection.Around,
    isBudgetPreload = false,
    shouldForceRender = false,
    forceLastSlice = false,
    onLoaded,
    onError,
    tabId = getCurrentTabId(),
  } = payload || {};

  let { chatId, threadId } = payload || {};

  if (!chatId || !threadId) {
    const currentMessageList = selectCurrentMessageList(global, tabId);
    if (!currentMessageList) {
      onError?.();
      return;
    }

    chatId = currentMessageList.chatId;
    threadId = currentMessageList.threadId;
  }

  const chat = selectChat(global, chatId);
  const isRestricted = selectIsChatRestricted(global, chatId);
  // TODO Revise if `isRestricted` check is needed
  if (!chat || isRestricted) {
    onError?.();
    return;
  }

  const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
  const listedIds = selectListedIds(global, chatId, threadId);

  if (!viewportIds || !viewportIds.length || direction === LoadMoreDirection.Around) {
    const offsetId = !forceLastSlice ? (
      selectFocusedMessageId(global, chatId, tabId) || selectRealLastReadId(global, chatId, threadId)
    ) : undefined;
    const isOutlying = Boolean(offsetId && listedIds && !listedIds.includes(offsetId));
    const historyIds = (isOutlying
      ? selectOutlyingListByMessageId(global, chatId, threadId, offsetId!)
      : listedIds) || [];
    const {
      newViewportIds, areSomeLocal, areAllLocal,
    } = getViewportSlice(historyIds, offsetId, LoadMoreDirection.Around);

    if (areSomeLocal) {
      global = safeReplaceViewportIds(global, chatId, threadId, newViewportIds, tabId);
    }

    if (!areAllLocal) {
      onTickEnd(() => {
        void loadViewportMessages(
          global, chat, threadId, offsetId, LoadMoreDirection.Around, isOutlying, isBudgetPreload, onLoaded, tabId,
        );
      });
    } else {
      onLoaded?.();
    }
  } else {
    const offsetId = !forceLastSlice ? (
      direction === LoadMoreDirection.Backwards ? viewportIds[0] : viewportIds[viewportIds.length - 1]
    ) : undefined;

    // Prevent requests with local offsets
    if (offsetId && isLocalMessageId(offsetId)) return;

    // Prevent unnecessary requests in threads
    if (offsetId === threadId && direction === LoadMoreDirection.Backwards) return;

    if (direction === LoadMoreDirection.Forwards && offsetId) {
      const threadInfo = selectThreadInfo(global, chatId, threadId);
      if (threadInfo?.lastMessageId && offsetId >= threadInfo.lastMessageId) {
        return;
      }
    }

    const isOutlying = Boolean(listedIds && offsetId && !listedIds.includes(offsetId));
    const historyIds = (isOutlying
      ? selectOutlyingListByMessageId(global, chatId, threadId, offsetId!) : listedIds)!;
    if (historyIds?.length) {
      const {
        newViewportIds, areSomeLocal, areAllLocal,
      } = getViewportSlice(historyIds, offsetId, direction);

      if (areSomeLocal) {
        global = safeReplaceViewportIds(global, chatId, threadId, newViewportIds, tabId);
      }

      onTickEnd(() => {
        void loadWithBudget(
          global,
          actions,
          areAllLocal,
          isOutlying,
          isBudgetPreload,
          chat,
          threadId,
          direction,
          offsetId,
          onLoaded,
          tabId,
        );
      });
    }

    if (isBudgetPreload) {
      return;
    }
  }

  setGlobal(global, { forceOnHeavyAnimation: shouldForceRender });
});

addActionHandler('cleanupExpiredTtlMessages', (global, actions, payload): ActionReturnType => {
  const { chatId, messageIds } = payload || {};

  if (chatId) {
    cleanupExpiredMessagesForChat(actions, chatId, messageIds);
    return;
  }

  Object.keys(global.messages.byChatId).forEach((id) => {
    cleanupExpiredMessagesForChat(actions, id);
  });
});

async function loadWithBudget<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  areAllLocal: boolean, isOutlying: boolean, isBudgetPreload: boolean,
  chat: ApiChat, threadId: ThreadId, direction: LoadMoreDirection, offsetId?: number,
  onLoaded?: NoneToVoidFunction,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  if (!areAllLocal) {
    await loadViewportMessages(
      global, chat, threadId, offsetId, direction, isOutlying, isBudgetPreload, onLoaded, tabId,
    );
  }

  if (!isBudgetPreload) {
    actions.loadViewportMessages({
      chatId: chat.id, threadId, direction, isBudgetPreload: true, onLoaded, tabId,
    });
  }
}

addActionHandler('loadMessage', async (global, actions, payload): Promise<void> => {
  const {
    chatId, messageId, replyOriginForId,
  } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const result = await callApi('fetchMessage', { chat, messageId });
  if (!result) {
    return undefined;
  }

  if (result === MESSAGE_DELETED) {
    if (replyOriginForId) {
      global = getGlobal();
      const replyMessage = selectChatMessage(global, chat.id, replyOriginForId);
      global = updateChatMessage(global, chat.id, replyOriginForId, {
        ...replyMessage,
        replyInfo: undefined,
      });
      setGlobal(global);
    }

    return undefined;
  }

  global = getGlobal();
  global = updateChatMessage(global, chat.id, messageId, result.message);
  setGlobal(global);
});

const richMessageLoads = new Map<string, Promise<void>>();

addActionHandler('loadRichMessage', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId, isScheduled } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  // Several callers (expanding, copying, playing) may request the same message while a load is pending
  const loadKey = `${chatId}-${messageId}${isScheduled ? '-scheduled' : ''}`;
  let load = richMessageLoads.get(loadKey);
  if (!load) {
    load = fetchAndStoreRichMessage(chat, messageId, isScheduled).finally(() => richMessageLoads.delete(loadKey));
    richMessageLoads.set(loadKey, load);
  }
  await load;
});

async function fetchAndStoreRichMessage(chat: ApiChat, messageId: number, isScheduled?: boolean) {
  const result = await callApi('fetchRichMessage', { chat, messageId });
  if (!result) {
    return;
  }

  let global = getGlobal();
  const currentMessage = isScheduled
    ? selectScheduledMessage(global, chat.id, messageId)
    : selectChatMessage(global, chat.id, messageId);
  const partCutoff = currentMessage?.content.richMessage?.partCutoff;
  const richMessage = result.message.content.richMessage;

  const updatedMessage = {
    ...result.message,
    content: {
      ...result.message.content,
      richMessage: richMessage && partCutoff !== undefined ? {
        ...richMessage,
        partCutoff,
      } : richMessage,
    },
  };
  global = isScheduled
    ? updateScheduledMessage(global, chat.id, messageId, updatedMessage)
    : updateChatMessage(global, chat.id, messageId, updatedMessage);
  setGlobal(global);
}

addActionHandler('startEditingMessage', async (global, actions, payload): Promise<void> => {
  const { messageId, tabId = getCurrentTabId() } = payload;
  const messageList = selectCurrentMessageList(global, tabId);
  if (!messageList) {
    return;
  }

  const { chatId, threadId, type } = messageList;
  const isScheduled = type === 'scheduled' || undefined;
  const message = isScheduled
    ? selectScheduledMessage(global, chatId, messageId)
    : selectChatMessage(global, chatId, messageId);
  if (!message) {
    return;
  }

  if (message.content.richMessage?.isPart) {
    await getPromiseActions().loadRichMessage({ chatId, messageId, isScheduled });

    global = getGlobal();
    const currentMessageList = selectCurrentMessageList(global, tabId);
    const richMessage = (isScheduled
      ? selectScheduledMessage(global, chatId, messageId)
      : selectChatMessage(global, chatId, messageId))?.content.richMessage;
    const isSameMessageList = currentMessageList?.chatId === chatId
      && currentMessageList.threadId === threadId
      && currentMessageList.type === type;

    if (!isSameMessageList || !richMessage || richMessage.isPart) {
      return;
    }
  }

  actions.setEditingId({ messageId, tabId });
});

addActionHandler('loadMessagesById', async (global, actions, payload): Promise<void> => {
  const { chatId, messageIds } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const messages = await callApi('fetchMessagesById', {
    chat,
    messageIds,
  });
  if (!messages) return;

  global = getGlobal();
  global = addChatMessagesById(global, chatId, buildCollectionByKey(messages, 'id'));
  setGlobal(global);
});

addActionHandler('sendMessage', async (global, actions, payload): Promise<void> => {
  const { messageList, tabId = getCurrentTabId() } = payload;

  const { storyId, peerId: storyPeerId } = selectCurrentViewedStory(global, tabId);
  const isStoryReply = Boolean(storyId && storyPeerId);

  if (!messageList && !isStoryReply) {
    return;
  }

  let { chatId, threadId, type } = messageList || {};
  if (isStoryReply) {
    chatId = storyPeerId!;
    threadId = MAIN_THREAD_ID;
    type = 'thread';
  }

  payload = omit(payload, ['tabId']);

  if (type === 'scheduled' && !payload.scheduledAt) {
    global = updateTabState(global, {
      contentToBeScheduled: payload,
    }, tabId);
    setGlobal(global);
    return;
  }

  const chat = selectChat(global, chatId!)!;
  const draft = selectDraft(global, chatId!, threadId!);
  const isForwarding = selectTabState(global, tabId).forwardMessages?.messageIds?.length;

  const draftReplyInfo = !isForwarding && !isStoryReply ? draft?.replyInfo : undefined;

  if (draftReplyInfo?.type === 'ephemeral') {
    if (!isEphemeralSendSupported(payload)) return;

    const replyMessage = selectEphemeralMessage(global, chatId!, draftReplyInfo.replyToMsgId);
    const receiver = replyMessage?.ephemeralBotId
      ? selectUser(global, replyMessage.ephemeralBotId) : undefined;
    if (!replyMessage || !receiver) return;

    void sendEphemeralMessages(global, {
      chat,
      receiver,
      text: payload.text,
      entities: payload.entities,
      richMessage: payload.richMessage,
      replyInfo: draftReplyInfo,
      attachments: payload.attachments || (payload.attachment ? [payload.attachment] : undefined),
      sticker: payload.sticker,
      gif: payload.gif,
      topMsgId: replyMessage.ephemeralTopMsgId,
      tabId,
    });
    actions.resetDraftReplyInfo({ chatId: chatId!, threadId: threadId! });
    actions.clearWebPagePreview({ chatId: chatId!, threadId: threadId! });
    return;
  }

  const storyReplyInfo = isStoryReply ? {
    type: 'story',
    peerId: storyPeerId!,
    storyId: storyId!,
  } satisfies ApiInputStoryReplyInfo : undefined;

  const messageReplyInfo = selectMessageReplyInfo(global, chatId!, threadId!, draftReplyInfo);

  const replyInfo = storyReplyInfo || messageReplyInfo;

  const threadInfo = selectThreadInfo(global, chatId!, threadId!);
  const lastMessageId = threadId === MAIN_THREAD_ID
    ? selectChatLastMessageId(global, chatId!) : threadInfo?.lastMessageId;

  const areStickersDisabled = isUserRightBanned(chat, 'sendStickers');

  const diceEmojies = global.appConfig.diceEmojies;
  let dice = payload.dice;
  if (!areStickersDisabled && payload.text && !payload.entities?.length && diceEmojies.includes(payload.text)) {
    dice = payload.text;
  }

  const params: SendMessageParams = {
    ...payload,
    chat,
    replyInfo,
    noWebPage: selectNoWebPage(global, chatId!, threadId!),
    lastMessageId,
    isStoryReply,
    dice,
    text: !dice && !payload.richMessage ? payload.text : undefined,
    entities: payload.richMessage ? undefined : payload.entities,
    richMessage: payload.richMessage,
  };

  if (!isStoryReply) {
    actions.clearWebPagePreview({ chatId: chatId!, threadId: threadId! });
  }

  if (!payload.scheduledAt && !isStoryReply) {
    actions.animateMessageSending({ chatId: chatId!, threadId: threadId!, tabId });
  }

  const isSingle = (!payload.attachments || payload.attachments.length <= 1) && !isForwarding;
  const isGrouped = !isSingle && payload.shouldGroupMessages;
  const queuedSends: SendMessageParams[] = [];

  if (isSingle) {
    const { attachments, ...restParams } = params;
    const sendParams: SendMessageParams = {
      ...restParams,
      attachment: attachments ? attachments[0] : undefined,
      wasDrafted: Boolean(draft),
    };
    queuedSends.push(sendParams);
  } else if (isGrouped) {
    const {
      text, entities, attachments, ...commonParams
    } = params;
    const byType = splitAttachmentsByType(attachments!);
    // The caption goes to the leading group if it is media, otherwise to the last group:
    // on the first item of a media group and on the last item of other groups
    const captionGroupIndex = getIsMediaGroup(byType[0]) ? 0 : byType.length - 1;

    for (let groupIndex = 0; groupIndex < byType.length; groupIndex++) {
      const group = byType[groupIndex];
      const groupedAttachments = split(group, MAX_MEDIA_FILES_FOR_ALBUM);
      for (let i = 0; i < groupedAttachments.length; i++) {
        const groupedId = `${Date.now()}${groupIndex}${i}`;
        const isCaptionGroup = groupIndex === captionGroupIndex;

        if (getIsMediaGroup(group)) {
          const [firstAttachment, ...restAttachments] = groupedAttachments[i];
          const hasCaption = isCaptionGroup && i === 0;

          let sendParams: SendMessageParams = {
            ...commonParams,
            text: hasCaption ? text : undefined,
            entities: hasCaption ? entities : undefined,
            attachment: firstAttachment,
            groupedId: restAttachments.length > 0 ? groupedId : undefined,
            wasDrafted: Boolean(draft),
          };
          queuedSends.push(sendParams);

          for (const attachment of restAttachments) {
            sendParams = {
              ...commonParams,
              attachment,
              groupedId,
            };
            queuedSends.push(sendParams);
          }
        } else {
          const firstAttachments = groupedAttachments[i].slice(0, -1);
          const lastAttachment = groupedAttachments[i][groupedAttachments[i].length - 1];
          for (const attachment of firstAttachments) {
            const sendParams = {
              ...commonParams,
              attachment,
              groupedId,
            };
            queuedSends.push(sendParams);
          }

          const hasCaption = isCaptionGroup && i === groupedAttachments.length - 1;
          const sendParams = {
            ...commonParams,
            text: hasCaption ? text : undefined,
            entities: hasCaption ? entities : undefined,
            attachment: lastAttachment,
            groupedId: firstAttachments.length > 0 ? groupedId : undefined,
            wasDrafted: Boolean(draft),
          };
          queuedSends.push(sendParams);
        }
      }
    }
  } else {
    const {
      text, entities, richMessage, attachments, replyInfo: replyToForFirstMessage, ...commonParams
    } = params;

    if (text || richMessage) {
      const sendParams = {
        ...commonParams,
        text,
        entities,
        richMessage,
        replyInfo: replyToForFirstMessage,
        wasDrafted: Boolean(draft),
      };
      queuedSends.push(sendParams);
    }

    if (attachments) {
      for (const attachment of attachments) {
        const sendParams = {
          ...commonParams,
          attachment,
        };
        queuedSends.push(sendParams);
      }
    }
  }
  const forwardingGlobal = global;
  if (isForwarding) {
    global = getGlobal();
    global = updateTabState(global, { forwardMessages: {}, isShareMessageModalShown: false }, tabId);
    setGlobal(global);
  }
  await sendWithVideoProcessing(global, queuedSends, tabId);
  if (isForwarding) {
    executeForwardMessages(forwardingGlobal, params, tabId);
  }
});

addActionHandler('sendInviteMessages', async (global, actions, payload): Promise<void> => {
  const { chatId, userIds, tabId = getCurrentTabId() } = payload;
  const chatFullInfo = selectChatFullInfo(global, chatId);
  if (!chatFullInfo?.inviteLink) {
    return undefined;
  }
  const userFullNames: string[] = [];
  await Promise.all(userIds.map((userId) => {
    const chat = selectChat(global, userId);
    if (!chat) {
      return Promise.resolve(undefined);
    }
    const userFullName = getUserFullName(getTranslationFn(), selectUser(global, userId));
    if (userFullName) {
      userFullNames.push(userFullName);
    }
    return sendMessage(global, {
      chat,
      text: chatFullInfo.inviteLink,
    });
  }));
  return actions.showNotification({
    message: {
      key: 'ConversationShareLinkTooltipChatOne',
      variables: {
        user: userFullNames.join(', '),
      },
      options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
    },
    tabId,
  });
});

addActionHandler('sendDiceInCurrentChat', (global, actions, payload): ActionReturnType => {
  const { emoji, tabId = getCurrentTabId() } = payload;
  const messageList = selectCurrentMessageList(global, tabId);
  if (!messageList) {
    return undefined;
  }

  actions.sendMessage({
    messageList,
    dice: emoji,
    tabId,
  });
});

addActionHandler('editMessage', (global, actions, payload): ActionReturnType => {
  const {
    messageList, text, entities, richMessage, attachments, tabId = getCurrentTabId(),
  } = payload;

  if (!messageList) {
    return;
  }

  const { chatId, threadId, type: messageListType } = messageList;
  const chat = selectChat(global, chatId);
  const message = selectEditingMessage(global, chatId, threadId, messageListType);
  if (!chat || !message) {
    return;
  }

  actions.setEditingId({ messageId: undefined, tabId });

  (async () => {
    let attachment = attachments?.[0];
    if (attachment?.videoProcessing) {
      setUploadProgress(getMessageKey(message), 0);
      try {
        attachment = await processMessageVideo(message, attachment);
      } catch {
        actions.showNotification({ message: { key: 'VideoProcessingFailed' }, tabId });
        return;
      }
      if (!attachment) return;
    }

    await sendWithUploadProgress(global, Boolean(attachments), (progressCallback) => callApi('editMessage', {
      chat,
      message,
      attachment,
      text,
      entities: richMessage ? undefined : entities,
      richMessage,
      noWebPage: selectNoWebPage(global, chatId, threadId),
    }, progressCallback), message);
  })();
});

addActionHandler('cancelUploadMedia', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId } = payload;

  const message = selectChatMessageOrEphemeral(global, chatId, messageId)
    ?? selectScheduledMessage(global, chatId, messageId);
  if (!message) return;

  if (message.isEphemeral) {
    actions.deleteEphemeralMessage({ chatId, messageId });
    return;
  }

  cancelMessageUpload(message);
  cancelVideoAttachmentProcessing(getMessageKey(message));

  if (isMessageLocal(message)) {
    actions.apiUpdate({
      '@type': message.isScheduled ? 'deleteScheduledMessages' : 'deleteMessages',
      ids: [messageId],
      chatId,
    });
  }
});

addActionHandler('saveDraft', (global, actions, payload): ActionReturnType => {
  const {
    chatId, threadId, text, richMessage,
  } = payload;
  const chat = selectChat(global, chatId);
  if ((!text && !richMessage) || !chat) {
    return;
  }

  const currentDraft = selectDraft(global, chatId, threadId);

  const newDraft: ApiDraft = {
    text: richMessage ? undefined : text,
    richMessage,
    replyInfo: currentDraft?.replyInfo,
  };

  saveDraft({
    global, chatId, threadId, draft: newDraft,
  });
});

addActionHandler('clearDraft', (global, actions, payload): ActionReturnType => {
  const {
    chatId, threadId = MAIN_THREAD_ID, isLocalOnly, shouldKeepReply,
  } = payload;
  const currentDraft = selectDraft(global, chatId, threadId);
  if (!currentDraft) {
    return;
  }

  const currentReplyInfo = currentDraft.replyInfo;

  const newDraft: ApiDraft | undefined = shouldKeepReply && currentReplyInfo ? {
    replyInfo: currentReplyInfo,
  } : undefined;

  saveDraft({
    global,
    chatId,
    threadId,
    draft: newDraft,
    isLocalOnly: isLocalOnly || currentReplyInfo?.type === 'ephemeral',
  });
});

addActionHandler('updateDraftReplyInfo', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId(), ...update } = payload;
  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return;
  }

  const { chatId, threadId } = currentMessageList;

  const currentDraft = selectDraft(global, chatId, threadId);

  let updatedReplyInfo: ApiInputDraftReplyInfo;
  if (update.type === 'ephemeral') {
    updatedReplyInfo = update;
  } else {
    const currentReplyInfo = currentDraft?.replyInfo?.type === 'message'
      ? currentDraft.replyInfo : undefined;
    const replyToMsgId = update.replyToMsgId || currentReplyInfo?.replyToMsgId;
    if (!replyToMsgId) return;

    // A new reply target, even with the same id in another chat, drops the previous quote and target
    const isNewTarget = update.replyToMsgId !== undefined;
    const baseReplyInfo = currentReplyInfo && isNewTarget
      ? omit(currentReplyInfo, [
        'replyToPeerId', 'quoteText', 'quoteRich', 'quoteOffset', 'pollOption',
      ]) : currentReplyInfo;

    updatedReplyInfo = {
      type: 'message',
      ...baseReplyInfo,
      ...update,
      replyToMsgId,
    };
  }

  const newDraft: ApiDraft = {
    ...currentDraft,
    replyInfo: updatedReplyInfo,
  };

  saveDraft({
    global, chatId, threadId, draft: newDraft, isLocalOnly: true, noLocalTimeUpdate: true,
  });
});

addActionHandler('resetDraftReplyInfo', (global, actions, payload): ActionReturnType => {
  const { chatId, threadId } = payload;
  const currentDraft = selectDraft(global, chatId, threadId);
  const newDraft: ApiDraft | undefined = !currentDraft?.text && !currentDraft?.richMessage ? undefined : {
    ...currentDraft,
    replyInfo: undefined,
  };

  saveDraft({
    global,
    chatId,
    threadId,
    draft: newDraft,
    isLocalOnly: Boolean(newDraft) || currentDraft?.replyInfo?.type === 'ephemeral',
  });
});

addActionHandler('updateInsertingPeerIdMention', (global, actions, payload): ActionReturnType => {
  const { peerId, tabId = getCurrentTabId() } = payload || {};
  return updateTabState(global, {
    insertingPeerIdMention: peerId,
  }, tabId);
});

async function saveDraft<T extends GlobalState>({
  global, chatId, threadId, draft, isLocalOnly, noLocalTimeUpdate,
}: {
  global: T; chatId: string; threadId: ThreadId; draft?: ApiDraft; isLocalOnly?: boolean; noLocalTimeUpdate?: boolean;
}) {
  const chat = selectChat(global, chatId);
  const user = selectUser(global, chatId);
  if (!chat || (user && isDeletedUser(user))) return;

  const replyInfo = selectMessageReplyInfo(global, chatId, threadId, draft?.replyInfo);

  const newDraft: ApiDraft | undefined = draft ? {
    ...draft,
    replyInfo,
    date: (noLocalTimeUpdate && draft.date) || getServerTime(),
    isLocal: true,
  } : undefined;

  global = replaceThreadLocalStateParam(global, chatId, threadId, 'draft', newDraft);

  setGlobal(global);

  if (isLocalOnly || draft?.replyInfo?.type === 'ephemeral') return;

  const result = await callApi('saveDraft', {
    chat,
    draft: newDraft,
  });

  if (!result || !newDraft) return;

  global = getGlobal();
  if (selectDraft(global, chatId, threadId) !== newDraft) return;

  const savedDraft: ApiDraft = {
    ...newDraft,
    isLocal: false,
  };
  global = replaceThreadLocalStateParam(global, chatId, threadId, 'draft', savedDraft);

  setGlobal(global);
}

addActionHandler('toggleMessageWebPage', (global, actions, payload): ActionReturnType => {
  const { chatId, threadId, noWebPage } = payload;

  return replaceThreadLocalStateParam(global, chatId, threadId, 'noWebPage', noWebPage);
});

addActionHandler('pinMessage', (global, actions, payload): ActionReturnType => {
  const {
    chatId, messageId, isUnpin, isOneSide, isSilent,
  } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  void callApi('pinMessage', {
    chat, messageId, isUnpin, isOneSide, isSilent,
  });
});

addActionHandler('unpinAllMessages', async (global, actions, payload): Promise<void> => {
  const { chatId, threadId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const result = await callApi('unpinAllMessages', { chat, threadId });
  if (!result) return;

  global = getGlobal();
  const pinnedIds = selectPinnedIds(global, chatId, threadId);
  pinnedIds?.forEach((id) => {
    global = updateChatMessage(global, chatId, id, { isPinned: false });
  });
  global = replaceThreadLocalStateParam(global, chat.id, threadId, 'pinnedIds', []);
  setGlobal(global);
});

addActionHandler('deleteMessages', (global, actions, payload): ActionReturnType => {
  const {
    messageIds, shouldDeleteForAll, messageList: payloadMessageList, tabId = getCurrentTabId(),
  } = payload;
  const currentMessageList = selectCurrentMessageList(global, tabId);
  const messageList = payloadMessageList || currentMessageList;
  if (!messageList) {
    return;
  }
  const { chatId, threadId } = messageList;
  const chat = selectChat(global, chatId)!;
  const messageIdsToDelete = messageIds.filter((id) => {
    const message = selectChatMessage(global, chatId, id);
    return message && !isMessageLocal(message);
  });

  // Only local messages
  if (!messageIdsToDelete.length && messageIds.length) {
    deleteMessages(global, undefined, messageIds, actions);
    return;
  }

  void callApi('deleteMessages', { chat, messageIds: messageIdsToDelete, shouldDeleteForAll });

  const editingId = selectEditingId(global, chatId, threadId);
  if (editingId && messageIds.includes(editingId)) {
    actions.setEditingId({ messageId: undefined, tabId });
  }
});

addActionHandler('deleteEphemeralMessage', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId } = payload;
  const message = selectEphemeralMessage(global, chatId, messageId);
  if (!message) return;

  const isLocal = isLocalMessageId(message.id);
  const shouldDeleteOnServer = !isLocal && (message.isOutgoing || Boolean(message.anchorMsgId));
  const chat = shouldDeleteOnServer ? selectChat(global, chatId) : undefined;
  const receiverId = message.anchorMsgId ? message.ephemeralReceiverId : message.ephemeralBotId;
  const receiver = shouldDeleteOnServer && receiverId ? selectUser(global, receiverId) : undefined;
  if (shouldDeleteOnServer && (!chat || !receiver)) {
    runForFocusedTabs(global, (tabId) => {
      actions.showNotification({ message: { key: 'ErrorUnspecified' }, tabId });
    });
    return;
  }

  cancelMessageUpload(message);
  cancelVideoAttachmentProcessing(getMessageKey(message));
  deleteEphemeralMessagesWithAnimation(global, chatId, [message.id]);

  if (!shouldDeleteOnServer) return;

  try {
    const result = await callApi('deleteEphemeralMessage', {
      chat: chat!,
      receiver: receiver!,
      messageId: message.id,
    });
    if (!result) throw new Error();
  } catch {
    global = getGlobal();
    global = updateEphemeralMessage(global, {
      ...message,
      isDeleting: undefined,
    });
    setGlobal(global);
    scheduleEphemeralExpiration(global);
    runForFocusedTabs(global, (tabId) => {
      actions.showNotification({ message: { key: 'ErrorUnspecified' }, tabId });
    });
  }
});

addActionHandler('deleteScheduledMessages', (global, actions, payload): ActionReturnType => {
  const { messageIds, tabId = getCurrentTabId() } = payload;
  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return;
  }

  const { chatId } = currentMessageList;
  const chat = selectChat(global, chatId)!;

  void callApi('deleteScheduledMessages', { chat, messageIds });

  const editingId = selectEditingScheduledId(global, chatId);
  if (editingId && messageIds.includes(editingId)) {
    actions.setEditingId({ messageId: undefined, tabId });
  }
});

addActionHandler('deleteHistory', async (global, actions, payload): Promise<void> => {
  const { chatId, shouldDeleteForAll, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const result = await callApi('deleteHistory', { chat, shouldDeleteForAll });
  if (!result) return;

  global = getGlobal();
  const activeChat = selectCurrentMessageList(global, tabId);
  if (activeChat && activeChat.chatId === chatId) {
    actions.openChat({ id: undefined, tabId });
  }

  // Delete chat from folders
  const folders = global.chatFolders.byId;
  Object.values(folders).forEach((folder) => {
    if (folder.includedChatIds.includes(chatId) || folder.pinnedChatIds?.includes(chatId)) {
      const newIncludedChatIds = folder.includedChatIds.filter((id) => id !== chatId);
      const newPinnedChatIds = folder.pinnedChatIds?.filter((id) => id !== chatId);

      const updatedFolder = {
        ...folder,
        includedChatIds: newIncludedChatIds,
        pinnedChatIds: newPinnedChatIds,
      };

      callApi('editChatFolder', {
        id: folder.id,
        folderUpdate: updatedFolder,
      });
    }
  });
});

addActionHandler('sendMessageAction', async (global, actions, payload): Promise<void> => {
  const { action, chatId, threadId } = payload;
  if (global.connectionState !== 'connectionStateReady') return;
  if (selectIsChatWithSelf(global, chatId)) return;

  const chat = selectChat(global, chatId)!;
  if (!chat) return;
  const user = selectUser(global, chatId);
  if (user && isDeletedUser(user)) return;

  await callApi('sendMessageAction', {
    peer: chat, threadId, action,
  });
});

addActionHandler('markMessageListRead', (global, actions, payload): ActionReturnType => {
  if (selectIsCurrentUserFrozen(global)) return undefined;
  const { maxId, tabId = getCurrentTabId() } = payload;
  if (isLocalMessageId(maxId)) return undefined;

  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return undefined;
  }

  const { chatId, threadId } = currentMessageList;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return undefined;
  }

  runDebouncedForMarkRead(() => {
    void callApi('markMessageListRead', {
      chat, threadId, maxId,
    });
  });

  const threadReadState = selectThreadReadState(global, chatId, threadId);
  global = replaceThreadReadStateParam(global, chatId, threadId, 'hasUnreadMark', undefined);

  const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
  const minId = selectFirstUnreadId(global, chatId, threadId);

  if (!viewportIds || !minId || !threadReadState?.unreadCount) {
    return global;
  }

  const readCount = countSortedIds(viewportIds, minId, maxId);
  if (!readCount) {
    return global;
  }

  const newUnreadCount = Math.max(0, (threadReadState.unreadCount || 0) - readCount);
  global = replaceThreadReadStateParam(global, chatId, threadId, 'unreadCount', newUnreadCount);
  global = replaceThreadReadStateParam(global, chatId, threadId, 'lastReadInboxMessageId', maxId);

  return global;
});

const pendingMediaReadIdsByChat = new Map<string, Set<number>>();

addActionHandler('markMessagesRead', async (global, actions, payload): Promise<void> => {
  const { chatId, messageIds } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const pendingIds = pendingMediaReadIdsByChat.get(chatId) || new Set<number>();
  const unreadIds = messageIds.filter((id) => !pendingIds.has(id));
  if (!unreadIds.length) return;

  pendingMediaReadIdsByChat.set(chatId, pendingIds);
  unreadIds.forEach((id) => pendingIds.add(id));
  try {
    await callApi('markMessagesRead', { chat, messageIds: unreadIds });
  } finally {
    unreadIds.forEach((id) => pendingIds.delete(id));
    if (!pendingIds.size) pendingMediaReadIdsByChat.delete(chatId);
  }
});

addActionHandler('loadWebPagePreview', async (global, actions, payload): Promise<void> => {
  const { chatId, threadId, text } = payload;
  const tokenKey = `${chatId}_${threadId}`;
  const token = Symbol('webPagePreview');
  webPagePreviewTokens.set(tokenKey, token);

  const webPagePreview = await callApi('fetchWebPagePreview', { text });
  if (webPagePreviewTokens.get(tokenKey) !== token) return;
  webPagePreviewTokens.delete(tokenKey);

  global = getGlobal();
  global = replaceThreadLocalStateParam(global, chatId, threadId, 'webPagePreviewId', webPagePreview?.id);
  setGlobal(global);

  if (!webPagePreview) return;

  actions.apiUpdate({
    '@type': 'updateWebPage',
    webPage: webPagePreview,
  });
});

addActionHandler('loadWebPage', async (global, actions, payload): Promise<void> => {
  const { url, hash } = payload;
  const webPage = await callApi('fetchWebPage', { url, hash });
  if (!webPage) return;

  actions.apiUpdate({
    '@type': 'updateWebPage',
    webPage,
  });
});

addActionHandler('clearWebPagePreview', (global, actions, payload): ActionReturnType => {
  const { chatId, threadId } = payload;
  webPagePreviewTokens.delete(`${chatId}_${threadId}`);

  return replaceThreadLocalStateParam(global, chatId, threadId, 'webPagePreviewId', undefined);
});

addActionHandler('sendPollVote', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, options } = payload;
  const chat = selectChat(global, chatId);

  if (chat) {
    void callApi('sendPollVote', { chat, messageId, options });
  }
});

addActionHandler('appendPollAnswer', async (global, actions, payload): Promise<void> => {
  const {
    chatId, messageId, text,
  } = payload;
  const chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  await callApi('appendPollAnswer', { chat, messageId, text });
});

addActionHandler('cancelPollVote', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId } = payload;
  const chat = selectChat(global, chatId);

  if (chat) {
    void callApi('sendPollVote', { chat, messageId, options: [] });
  }
});

addActionHandler('closePoll', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId } = payload;
  const chat = selectChat(global, chatId);
  const message = selectChatMessage(global, chatId, messageId);
  const poll = message && selectPollFromMessage(global, message);
  if (chat && poll) {
    void callApi('closePoll', { chat, messageId, poll });
  }
});

addActionHandler('loadPollOptionResults', async (global, actions, payload): Promise<void> => {
  const {
    chat, messageId, option, offset, limit, shouldResetVoters, tabId = getCurrentTabId(),
  } = payload;

  const result = await callApi('loadPollOptionResults', {
    chat, messageId, option, offset, limit,
  });

  if (!result) {
    return;
  }

  global = getGlobal();

  const tabState = selectTabState(global, tabId);
  const { pollResults } = tabState;
  const { votesByOption } = pollResults;

  const existingVotes = !shouldResetVoters && votesByOption?.[option] ? votesByOption[option] : [];
  const newVotes = uniqueByField([...existingVotes, ...result.votes], 'peerId');

  global = updateTabState(global, {
    pollResults: {
      ...pollResults,
      votesByOption: {
        ...votesByOption,
        [option]: newVotes,
      },
      offsets: {
        ...(pollResults.offsets ? pollResults.offsets : {}),
        [option]: result.nextOffset || '',
      },
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('loadExtendedMedia', (global, actions, payload): ActionReturnType => {
  const { chatId, ids } = payload;
  const chat = selectChat(global, chatId);
  if (chat) {
    void callApi('fetchExtendedMedia', { chat, ids });
  }
});

addActionHandler('loadScheduledHistory', async (global, actions, payload): Promise<void> => {
  if (selectIsCurrentUserFrozen(global)) return;

  const { chatId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const result = await callApi('fetchScheduledHistory', { chat });
  if (!result) {
    return;
  }

  const { messages }: { messages: ApiMessage[] } = result;

  const byId = buildCollectionByKey(messages, 'id');
  const ids = Object.keys(byId).map(Number).sort((a, b) => b - a);

  global = getGlobal();
  global = updateScheduledMessages(global, chat.id, byId);

  const idsByThreadId = groupMessageIdsByThreadId(global, chat.id, ids, true);
  if (!ids.length) {
    global = updatePeerFullInfo(global, chat.id, { hasScheduledMessages: false });
  }

  Object.entries(idsByThreadId).forEach(([tId, newThreadScheduledIds]) => {
    const threadId = tId as ThreadId;
    global = replaceThreadLocalStateParam(global, chat.id, threadId, 'scheduledIds', newThreadScheduledIds);
  });
  setGlobal(global);
});

addActionHandler('sendScheduledMessages', (global, actions, payload): ActionReturnType => {
  const {
    chatId, id,
  } = payload;

  const chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  void callApi('sendScheduledMessages', {
    chat,
    ids: [id],
  });
});

addActionHandler('rescheduleMessage', (global, actions, payload): ActionReturnType => {
  const {
    chatId, messageId, scheduledAt,
  } = payload;

  const chat = selectChat(global, chatId);
  const message = chat && selectScheduledMessage(global, chat.id, messageId);
  if (!chat || !message) {
    return;
  }

  void callApi('rescheduleMessage', {
    chat,
    message,
    scheduledAt,
  });
});

addActionHandler('saveVoiceWaveform', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, waveform } = payload;

  const message = selectChatMessage(global, chatId, messageId);
  const voice = message?.content.voice;
  if (!voice || voice.waveform?.length) {
    return undefined;
  }

  return updateChatMessage(global, chatId, messageId, {
    content: {
      ...message.content,
      voice: { ...voice, waveform },
    },
  });
});

addActionHandler('loadCustomEmojis', async (global, actions, payload): Promise<void> => {
  const { ids, ignoreCache } = payload;
  const newCustomEmojiIds = ignoreCache ? ids
    : unique(ids.filter((documentId) => !selectCustomEmoji(global, documentId)));
  const customEmoji = await callApi('fetchCustomEmoji', {
    documentId: newCustomEmojiIds,
  });
  if (!customEmoji) return;

  global = getGlobal();
  global = {
    ...global,
    customEmojis: {
      ...global.customEmojis,
      byId: {
        ...global.customEmojis.byId,
        ...buildCollectionByKey(customEmoji, 'id'),
      },
    },
  };
  setGlobal(global);
});

addActionHandler('forwardMessages', (global, actions, payload): ActionReturnType => {
  const {
    isSilent, scheduledAt, tabId = getCurrentTabId(),
  } = payload;
  const { toChatId, toThreadId = MAIN_THREAD_ID } = selectTabState(global, tabId).forwardMessages;
  const toChat = toChatId ? selectChat(global, toChatId) : undefined;
  if (!toChat) return;

  // `sendMessage` advances the gradient for forwards-with-comment, which go through it instead
  if (!scheduledAt) {
    actions.animateMessageSending({ chatId: toChat.id, threadId: toThreadId, tabId });
  }

  executeForwardMessages(global, { chat: toChat, isSilent, scheduledAt }, tabId);
});

function executeForwardMessages(global: GlobalState, sendParams: SendMessageParams, tabId: number) {
  const { forwardMessages } = selectTabState(global, tabId);
  const {
    fromChatId, messageIds, toChatId, withMyScore, noAuthors, noCaptions, toThreadId = MAIN_THREAD_ID,
  } = forwardMessages;
  const { isSilent, scheduledAt } = sendParams;

  const isToMainThread = toThreadId === MAIN_THREAD_ID;

  const fromChat = fromChatId ? selectChat(global, fromChatId) : undefined;
  const toChat = toChatId ? selectChat(global, toChatId) : undefined;

  const messages = fromChatId && messageIds
    ? messageIds
      .sort((a, b) => a - b)
      .map((id) => selectChatMessageOrEphemeral(global, fromChatId, id)).filter(Boolean)
    : undefined;

  if (!fromChat || !toChat || !messages || (toThreadId && !isToMainThread)) {
    return undefined;
  }

  const privateForwardName = selectUserFullInfo(global, fromChat.id)?.privateForwardName;
  const draft = selectDraft(global, toChatId!, toThreadId || MAIN_THREAD_ID);
  const lastMessageId = selectChatLastMessageId(global, toChat.id);

  const forwardableMessages = messages.filter((message) => selectCanForwardMessage(global, message));
  const [ephemeralMessages, regularMessages] = partition(forwardableMessages, (message) => message.isEphemeral);
  for (const messagesToForward of [regularMessages, ephemeralMessages]) {
    if (!messagesToForward.length) continue;

    const messageSlices = global.config?.maxForwardedCount
      ? splitMessagesForForwarding(messagesToForward, global.config.maxForwardedCount)
      : [messagesToForward];
    for (const slice of messageSlices) {
      const forwardParams: ForwardMessagesParams = {
        fromChat,
        toChat,
        toThreadId,
        messages: slice,
        isSilent,
        scheduledAt,
        withMyScore,
        noAuthors,
        noCaptions,
        privateForwardName,
        wasDrafted: Boolean(draft),
        lastMessageId,
      };

      callApi('forwardMessages', forwardParams);
    }
  }

  global = getGlobal();
  if (selectTabState(global, tabId).forwardMessages === forwardMessages) {
    global = updateTabState(global, {
      forwardMessages: {},
      isShareMessageModalShown: false,
    }, tabId);
    setGlobal(global);
  }
}

function cleanupExpiredMessagesForChat(
  actions: RequiredGlobalActions,
  chatId: string,
  messageIds?: number[],
) {
  const global = getGlobal();
  const byId = selectChatMessages(global, chatId);
  if (!byId) return;

  const serverTime = getServerTime();
  const messages = messageIds
    ? messageIds.map((id) => byId[id]).filter(Boolean)
    : Object.values(byId);

  const expiredIds: number[] = [];
  let closestExpiresAt: number | undefined;

  messages.forEach((message) => {
    if (!message.ttlPeriod) return;

    const expiresAt = message.date + message.ttlPeriod;
    if (expiresAt <= serverTime) {
      expiredIds.push(message.id);
    } else if (!closestExpiresAt || expiresAt < closestExpiresAt) {
      closestExpiresAt = expiresAt;
    }
  });

  if (expiredIds.length) {
    deleteMessages(global, chatId, expiredIds, actions);
  }

  const current = ttlCleanupTimersByChatId.get(chatId);

  if (messageIds) {
    // Incremental pass: only tighten the timer, the scheduled full pass covers the rest
    if (closestExpiresAt && (!current || closestExpiresAt < current.expiresAt)) {
      scheduleTtlCleanup(actions, chatId, closestExpiresAt, serverTime);
    }
    return;
  }

  if (current) {
    clearTimeout(current.timer);
    ttlCleanupTimersByChatId.delete(chatId);
  }

  if (closestExpiresAt === undefined) return;

  scheduleTtlCleanup(actions, chatId, closestExpiresAt, serverTime);
}

function scheduleTtlCleanup(
  actions: RequiredGlobalActions,
  chatId: string,
  expiresAt: number,
  serverTime: number,
) {
  const current = ttlCleanupTimersByChatId.get(chatId);
  if (current) {
    clearTimeout(current.timer);
  }

  const delay = Math.min(
    (expiresAt - serverTime) * SECOND_IN_MS + TTL_CLEANUP_DELAY_BUFFER,
    TTL_CLEANUP_MAX_DELAY,
  );
  const timer = window.setTimeout(() => {
    ttlCleanupTimersByChatId.delete(chatId);
    actions.cleanupExpiredTtlMessages({ chatId });
  }, delay);
  ttlCleanupTimersByChatId.set(chatId, { timer, expiresAt });
}

async function loadViewportMessages<T extends GlobalState>(
  global: T,
  chat: ApiChat,
  threadId: ThreadId,
  offsetId: number | undefined,
  direction: LoadMoreDirection,
  isOutlying = false,
  isBudgetPreload = false,
  onLoaded?: NoneToVoidFunction,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const chatId = chat.id;

  let addOffset: number | undefined;
  let sliceSize = MESSAGE_LIST_SLICE;
  switch (direction) {
    case LoadMoreDirection.Backwards:
      if (offsetId) {
        addOffset = -1;
        sliceSize += 1;
      } else {
        addOffset = undefined;
      }
      break;
    case LoadMoreDirection.Around:
      addOffset = -(Math.round(MESSAGE_LIST_SLICE / 2) + 1);
      break;
    case LoadMoreDirection.Forwards:
      addOffset = -(MESSAGE_LIST_SLICE + 1);
      if (offsetId) {
        sliceSize += 1;
      }
      break;
  }

  global = getGlobal();

  const result = await callApi('fetchMessages', {
    chat: selectChat(global, chatId)!,
    offsetId,
    addOffset,
    limit: sliceSize,
  });

  if (!result) {
    return;
  }

  const {
    messages, count,
  } = result;

  global = getGlobal();

  const localTypingDrafts = selectThreadLocalStateParam(global, chatId, threadId, 'typingDraftIdByRandomId');
  const typingDraftMessages = localTypingDrafts ? Object.values(localTypingDrafts)
    .map((id) => selectChatMessage(global, chatId, id))
    .filter(Boolean) : [];
  const allMessages = ([] as ApiMessage[]).concat(messages, typingDraftMessages);
  const byId = buildCollectionByKey(allMessages, 'id');
  const ids = Object.keys(byId).map(Number);

  global = addChatMessagesById(global, chatId, byId);
  global = isOutlying
    ? updateOutlyingLists(global, chatId, threadId, ids)
    : updateListedIds(global, chatId, threadId, ids);

  let listedIds = selectListedIds(global, chatId, threadId);
  const outlyingList = offsetId ? selectOutlyingListByMessageId(global, chatId, threadId, offsetId) : undefined;

  if (isOutlying && listedIds && outlyingList) {
    if (!outlyingList.length || areSortedArraysIntersecting(listedIds, outlyingList)) {
      global = updateListedIds(global, chatId, threadId, outlyingList);
      listedIds = selectListedIds(global, chatId, threadId);
      global = removeOutlyingList(global, chatId, threadId, outlyingList);
      isOutlying = false;
    }
  }

  if (!isBudgetPreload) {
    const historyIds = isOutlying && outlyingList ? outlyingList : listedIds;
    if (historyIds) {
      const { newViewportIds } = getViewportSlice(historyIds, offsetId, direction);
      global = safeReplaceViewportIds(global, chatId, threadId, newViewportIds, tabId);
    }
  }

  if (count !== undefined) {
    global = updateThreadInfoMessagesCount(global, chat.id, threadId, count);
  }

  setGlobal(global);
  onLoaded?.();

  getActions().cleanupExpiredTtlMessages({ chatId, messageIds: ids });
}

function findClosestIndex(sourceIds: number[], offsetId: number) {
  if (offsetId < sourceIds[0]) {
    return 0;
  }

  if (offsetId > sourceIds[sourceIds.length - 1]) {
    return sourceIds.length - 1;
  }

  return sourceIds.findIndex((id, i) => (
    id === offsetId
    || (id < offsetId && sourceIds[i + 1] > offsetId)
  ));
}

function getViewportSlice(
  sourceIds: number[],
  offsetId: number | undefined,
  direction: LoadMoreDirection,
) {
  const { length } = sourceIds;
  const index = offsetId ? findClosestIndex(sourceIds, offsetId) : -1;
  const isBackwards = direction === LoadMoreDirection.Backwards;
  const isAround = direction === LoadMoreDirection.Around;
  const indexForDirection = isBackwards ? index : (index + 1) || length;
  const sliceSize = isAround ? Math.round(MESSAGE_LIST_SLICE / 2) : MESSAGE_LIST_SLICE;
  const from = indexForDirection - sliceSize;
  const to = indexForDirection + sliceSize - 1;
  const newViewportIds = sourceIds.slice(Math.max(0, from), to + 1);

  let areSomeLocal;
  let areAllLocal;
  switch (direction) {
    case LoadMoreDirection.Backwards:
      areSomeLocal = indexForDirection >= 0;
      areAllLocal = from >= 0;
      break;
    case LoadMoreDirection.Forwards:
      areSomeLocal = indexForDirection < length;
      areAllLocal = to <= length - 1;
      break;
    case LoadMoreDirection.Around:
    default:
      areSomeLocal = newViewportIds.length > 0;
      areAllLocal = newViewportIds.length === MESSAGE_LIST_SLICE;
      break;
  }

  return { newViewportIds, areSomeLocal, areAllLocal };
}

async function sendWithVideoProcessing<T extends GlobalState>(
  global: T,
  sends: SendMessageParams[],
  tabId: number,
) {
  if (!sends.some(({ attachment }) => attachment?.videoProcessing)) {
    for (const sendParams of sends) {
      sendMessage(global, sendParams);
    }
    return;
  }

  const withLocalMessages: SendMessageParams[] = [];
  for (const sendParams of sends) {
    const localMessage = await callApi('sendMessageLocal', sendParams);
    if (localMessage) withLocalMessages.push({ ...sendParams, localMessage });
  }

  withLocalMessages.forEach(({ attachment, localMessage }) => {
    if (!attachment?.videoProcessing) return;
    setUploadProgress(getMessageKey(localMessage!), 0);
  });

  let pendingGroup: SendMessageParams[] = [];
  // A dropped item's caption moves to the next surviving singleton or to the last item of the next album
  let orphanSend: SendMessageParams | undefined;
  const dropSend = (sendParams: SendMessageParams) => {
    clearProcessedVideoProgress(getMessageKey(sendParams.localMessage!));
    if (sendParams.text && sendParams.attachment) orphanSend = sendParams;
  };
  const takeOrphanCaption = (sendParams: SendMessageParams): SendMessageParams => {
    if (!orphanSend) return sendParams;

    const { text, entities, localMessage: orphanMessage } = orphanSend;
    if (hasLocalMessage(orphanSend)) updateLocalMessageContent(orphanMessage!, omit(orphanMessage!.content, ['text']));
    orphanSend = undefined;
    const { localMessage } = sendParams;
    const content = { ...localMessage!.content, text: orphanMessage!.content.text };
    return { ...sendParams, text, entities, localMessage: updateLocalMessageContent(localMessage!, content) };
  };
  const flushPendingGroup = () => {
    const group = pendingGroup.filter((sendParams) => {
      if (hasLocalMessage(sendParams)) return true;
      dropSend(sendParams);
      return false;
    });
    pendingGroup = [];

    const lastIndex = group.length - 1;
    if (lastIndex >= 0) group[lastIndex] = takeOrphanCaption(group[lastIndex]);
    if (group.length === 1) group[0] = { ...group[0], groupedId: undefined };

    for (const sendParams of group) {
      sendMessage(global, sendParams);
    }
  };

  for (const sendParams of withLocalMessages) {
    if (pendingGroup.length && pendingGroup[0].groupedId !== sendParams.groupedId) {
      flushPendingGroup();
    }

    let prepared: SendMessageParams | undefined = hasLocalMessage(sendParams) ? sendParams : undefined;
    if (prepared && sendParams.attachment?.videoProcessing) {
      try {
        prepared = await processVideoSend(sendParams);
      } catch {
        prepared = undefined;
        const { chatId, id, isScheduled } = sendParams.localMessage!;
        getActions().apiUpdate({
          '@type': isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
          chatId,
          localId: id,
          error: VIDEO_PROCESSING_FAILED_ERROR,
        });
        getActions().showNotification({ message: { key: 'VideoProcessingFailed' }, tabId });
      }
    }
    if (!prepared || !hasLocalMessage(prepared)) {
      dropSend(sendParams);
      continue;
    }

    if (prepared.groupedId) {
      pendingGroup.push(prepared);
    } else {
      sendMessage(global, takeOrphanCaption(prepared));
    }
  }

  flushPendingGroup();
}

function hasLocalMessage({ localMessage }: SendMessageParams) {
  return getIsMessageAlive(localMessage!);
}

function getIsMessageAlive({ chatId, id, isScheduled }: ApiMessage) {
  const global = getGlobal();
  const message = isScheduled
    ? selectScheduledMessage(global, chatId, id) : selectChatMessageOrEphemeral(global, chatId, id);
  return Boolean(message && !message.isDeleting);
}

function clearProcessedVideoProgress(messageKey: MessageKey) {
  processedVideoMessageKeys.delete(messageKey);
  setUploadProgress(messageKey, undefined);
}

async function processVideoSend(sendParams: SendMessageParams) {
  const { attachment, localMessage } = sendParams;
  const processedAttachment = await processMessageVideo(localMessage!, attachment!);
  if (!processedAttachment) return undefined;

  return {
    ...sendParams,
    attachment: processedAttachment,
    localMessage: updateLocalMessageContent(localMessage!, buildProcessedContent(localMessage!, processedAttachment)),
  };
}

function buildProcessedContent(localMessage: ApiMessage, processedAttachment: ApiAttachment): MediaContent {
  const { video, ...media } = buildUploadingMedia(processedAttachment);

  return {
    ...omit(localMessage.content, ['photo', 'document']),
    ...media,
    video: video ? { ...video, previewBlobUrl: processedAttachment.previewBlobUrl } : undefined,
  };
}

async function processMessageVideo(message: ApiMessage, attachment: ApiAttachment) {
  const messageKey = getMessageKey(message);
  let processedAttachment: ApiAttachment | undefined;

  try {
    processedAttachment = await processVideoAttachment(messageKey, attachment, (progress) => (
      setUploadProgress(messageKey, progress * VIDEO_PROCESSING_PROGRESS_SHARE)
    ));
    if (processedAttachment && !getIsMessageAlive(message)) {
      revokeAttachmentUrls(processedAttachment, [attachment]);
      processedAttachment = undefined;
    }
    return processedAttachment;
  } finally {
    if (processedAttachment) processedVideoMessageKeys.add(messageKey);
    setUploadProgress(messageKey, processedAttachment ? VIDEO_PROCESSING_PROGRESS_SHARE : undefined);
  }
}

function updateLocalMessageContent(localMessage: ApiMessage, content: MediaContent): ApiMessage {
  getActions().apiUpdate({
    '@type': localMessage.isScheduled ? 'updateScheduledMessage' : 'updateMessage',
    chatId: localMessage.chatId,
    id: localMessage.id,
    message: { content },
    isFull: false,
  });

  return { ...localMessage, content };
}

function setUploadProgress(messageKey: MessageKey, progress: number | undefined) {
  let global = getGlobal();
  global = updateUploadByMessageKey(global, messageKey, progress);
  setGlobal(global);
}

async function sendMessage<T extends GlobalState>(global: T, params: SendMessageParams) {
  // @optimization
  if (params.replyInfo || IS_IOS) {
    await rafPromise();
  }

  await sendWithUploadProgress(global, Boolean(params.attachment), (progressCallback) => (
    callApi('sendMessage', params, progressCallback)
  ), params.localMessage);
}

async function sendEphemeralMessages<T extends GlobalState>(
  global: T,
  {
    chat,
    receiver,
    text,
    entities,
    richMessage,
    replyInfo,
    attachments,
    sticker,
    gif,
    topMsgId,
    tabId,
  }: SendEphemeralMessagesParams,
) {
  if (sticker || gif || !attachments?.length) {
    await callApi('sendEphemeralMessage', {
      chat,
      receiver,
      text,
      entities,
      richMessage,
      replyInfo,
      sticker,
      gif,
      topMsgId,
    });
    return;
  }

  let hasSentCaption = false;
  let captionPlaceholder: ApiMessage | undefined;
  for (const attachment of attachments) {
    if (captionPlaceholder) {
      removeEphemeralCaption(captionPlaceholder);
      captionPlaceholder = undefined;
    }

    const sendParams = {
      chat,
      receiver,
      text: hasSentCaption ? undefined : text,
      entities: hasSentCaption ? undefined : entities,
      richMessage: hasSentCaption ? undefined : richMessage,
      replyInfo,
      attachment,
      topMsgId,
    };
    let localMessage: ApiMessage | undefined;
    let preparedAttachment: ApiAttachment | undefined = attachment;
    if (attachment.videoProcessing) {
      localMessage = await callApi('sendEphemeralMessageLocal', sendParams);
      if (!localMessage) continue;

      // A failed or cancelled item keeps its placeholder, and the caption moves to the next item
      preparedAttachment = await processEphemeralVideo(localMessage, attachment, tabId);
      if (!preparedAttachment) {
        if (sendParams.text || sendParams.richMessage) captionPlaceholder = localMessage;
        continue;
      }

      localMessage = { ...localMessage, content: buildProcessedContent(localMessage, preparedAttachment) };
      getActions().apiUpdate({ '@type': 'updateEphemeralMessage', message: localMessage });
    }

    const result = await sendWithUploadProgress(global, true, (progressCallback) => (
      callApi('sendEphemeralMessage', { ...sendParams, attachment: preparedAttachment, localMessage }, progressCallback)
    ), localMessage);
    if (!result) return;
    hasSentCaption = true;
  }
}

async function processEphemeralVideo(localMessage: ApiMessage, attachment: ApiAttachment, tabId?: number) {
  setUploadProgress(getMessageKey(localMessage), 0);

  try {
    return await processMessageVideo(localMessage, attachment);
  } catch {
    getActions().apiUpdate({
      '@type': 'updateEphemeralMessage',
      message: { ...localMessage, sendingState: 'messageSendingStateFailed' },
    });
    getActions().showNotification({ message: { key: 'VideoProcessingFailed' }, tabId });
    return undefined;
  }
}

function removeEphemeralCaption({ chatId, id }: ApiMessage) {
  const global = getGlobal();
  const message = selectEphemeralMessage(global, chatId, id);
  if (!message) return;

  getActions().apiUpdate({
    '@type': 'updateEphemeralMessage',
    message: { ...message, content: omit(message.content, ['text', 'richMessage']) },
  });
}

async function sendWithUploadProgress<T extends GlobalState, TResult>(
  global: T,
  hasAttachment: boolean,
  send: (progressCallback?: ApiOnProgress) => Promise<TResult>,
  message?: ApiMessage,
) {
  if (!hasAttachment) return send();

  let currentMessageKey = message && getMessageKey(message);
  const startProgress = currentMessageKey && processedVideoMessageKeys.delete(currentMessageKey)
    ? VIDEO_PROCESSING_PROGRESS_SHARE : 0;
  const progressCallback: ApiOnProgress = (progress, messageKey: MessageKey) => {
    if (!currentMessageKey) {
      currentMessageKey = messageKey;
      uploadProgressCallbacks.set(messageKey, progressCallback);
    }

    global = getGlobal();
    global = updateUploadByMessageKey(global, messageKey, startProgress + (1 - startProgress) * progress);
    setGlobal(global);
  };
  if (currentMessageKey) uploadProgressCallbacks.set(currentMessageKey, progressCallback);

  try {
    return await send(progressCallback);
  } finally {
    if (currentMessageKey) {
      global = getGlobal();
      global = updateUploadByMessageKey(global, currentMessageKey, undefined);
      setGlobal(global);

      if (uploadProgressCallbacks.get(currentMessageKey) === progressCallback) {
        uploadProgressCallbacks.delete(currentMessageKey);
      }
    }
  }
}

function cancelMessageUpload(message: ApiMessage) {
  const progressCallback = uploadProgressCallbacks.get(getMessageKey(message));
  if (progressCallback) cancelApiProgress(progressCallback);
}

addActionHandler('loadPinnedMessages', async (global, actions, payload): Promise<void> => {
  const { chatId, threadId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const result = await callApi('fetchPinnedMessages', { chat, threadId });
  if (!result) {
    return;
  }

  const { messages }: { messages: ApiMessage[] } = result;

  const byId = buildCollectionByKey(messages, 'id');
  const ids = Object.keys(byId).map(Number).sort((a, b) => b - a);

  global = getGlobal();
  global = addChatMessagesById(global, chat.id, byId);
  global = safeReplacePinnedIds(global, chat.id, threadId, ids);
  setGlobal(global);
});

addActionHandler('loadSeenBy', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const result = await callApi('fetchSeenBy', { chat, messageId });
  if (!result) {
    return;
  }

  global = getGlobal();
  global = updateChatMessage(global, chatId, messageId, {
    seenByDates: result,
  });
  setGlobal(global);
});

addActionHandler('loadMessageDetails', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  const result = await callApi('fetchMessageSendDetails', { chat, messageId });
  if (!result) return;

  global = getGlobal();
  const modal = selectTabState(global, tabId).messageDetailsModal;
  if (modal?.chatId !== chatId || modal.messageId !== messageId) return;
  global = updateTabState(global, { messageDetailsModal: { ...modal, recipients: result.recipients } }, tabId);
  setGlobal(global);
});

addActionHandler('resendMessage', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  const result = await callApi('resendMessage', { chat, messageId });
  if (!result) {
    actions.showNotification({ message: { key: 'MessageResendFailed' }, tabId });
    return;
  }

  global = getGlobal();
  const modal = selectTabState(global, tabId).messageDetailsModal;
  if (modal?.chatId === chatId && modal.messageId === messageId) {
    actions.loadMessageDetails({ chatId, messageId, tabId });
  }
});

addActionHandler('openUrl', (global, actions, payload): ActionReturnType => {
  const {
    url, shouldSkipModal, ignoreDeepLinks, linkContext, tabId = getCurrentTabId(),
  } = payload;
  const signalLink = !ignoreDeepLinks ? parseSignalLink(url) : undefined;
  if (signalLink) {
    actions.closeStoryViewer({ tabId });

    openSignalLink(signalLink, tabId);
    return;
  }

  const urlWithProtocol = ensureProtocol(url);
  const parsedUrl = new URL(urlWithProtocol);

  if (!ignoreDeepLinks && isDeepLink(urlWithProtocol)) {
    actions.closeStoryViewer({ tabId });

    actions.openTelegramLink({ url, linkContext, tabId });
    return;
  }

  const { appConfig, config } = global;
  if (
    parsedUrl.protocol === 'https:'
    && config?.autologinToken
    && appConfig.autologinDomains.includes(parsedUrl.hostname)
  ) {
    parsedUrl.searchParams.set(AUTOLOGIN_TOKEN_KEY, config.autologinToken);
    window.open(parsedUrl.href, '_blank', 'noopener');
    return;
  }

  const isWhitelisted = appConfig.whitelistedDomains.includes(parsedUrl.hostname);

  const shouldDisplayModal = !shouldSkipModal && !isWhitelisted;

  if (shouldDisplayModal) {
    actions.toggleSafeLinkModal({ url: urlWithProtocol, tabId });
  } else {
    window.open(parsedUrl, '_blank', 'noopener');
  }
});

async function checkIfVoiceMessagesAllowed<T extends GlobalState>(
  global: T,
  user: ApiUser,
  chatId: string,
): Promise<boolean> {
  let fullInfo = selectUserFullInfo(global, chatId);
  if (!fullInfo) {
    const { accessHash } = user;
    const result = await callApi('fetchFullUser', { id: chatId, accessHash });
    fullInfo = result?.fullInfo;
  }
  return Boolean(!fullInfo?.noVoiceMessages);
}

function moveReplyToNewDraft<T extends GlobalState>(
  global: T,
  threadId: ThreadId,
  replyInfo: ApiInputMessageReplyInfo,
  toChatId: string,
) {
  const currentDraft = selectDraft(global, toChatId, threadId);

  if (!replyInfo.replyToMsgId) return;

  const newDraft: ApiDraft = {
    ...currentDraft,
    replyInfo,
  };

  saveDraft({
    global, chatId: toChatId, threadId, draft: newDraft, isLocalOnly: true, noLocalTimeUpdate: true,
  });
}
addActionHandler('openChatWithReplyInDraft', (global, actions, payload): ActionReturnType => {
  const { chatId: toChatId, tabId = getCurrentTabId() } = payload;

  global = getGlobal();

  const tabState = selectTabState(global, tabId);
  const replyingInfo = tabState.replyingMessage;

  global = updateTabState(global, {
    isShareMessageModalShown: false,
    replyingMessage: {},
  }, tabId);
  setGlobal(global);
  global = getGlobal();

  const currentChat = selectCurrentChat(global, tabId);
  const currentThreadId = selectCurrentMessageList(global, tabId)?.threadId;

  if (!currentChat || !currentThreadId) return;

  const threadId = MAIN_THREAD_ID;
  const currentChatId = currentChat.id;

  const newReplyInfo = {
    type: 'message',
    replyToMsgId: replyingInfo.messageId,
    replyToTopId: replyingInfo.toThreadId,
    replyToPeerId: currentChatId,
    monoforumPeerId: replyingInfo.toThreadId,
    quoteText: replyingInfo.quoteText,
    quoteRich: replyingInfo.quoteRich,
    quoteOffset: replyingInfo.quoteOffset,
  } as ApiInputMessageReplyInfo;

  const currentReplyInfo = replyingInfo.messageId
    ? newReplyInfo : selectDraft(global, currentChatId, currentThreadId)?.replyInfo;
  if (!currentReplyInfo) return;
  if (currentReplyInfo.type === 'ephemeral') return;

  if (!selectReplyCanBeSentToChat(global, toChatId, currentChatId, currentReplyInfo)) {
    actions.showNotification({ message: {
      key: 'ChatSendNotAllowedText',
      options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
    }, tabId });
    return;
  }

  if (!currentReplyInfo.replyToPeerId && toChatId === currentChat.id) return;

  const getPeerId = () => {
    if (!currentReplyInfo?.replyToPeerId) return currentChatId;
    return currentReplyInfo.replyToPeerId === toChatId ? undefined : currentReplyInfo.replyToPeerId;
  };
  const replyToPeerId = getPeerId();
  const newReply: ApiInputMessageReplyInfo = {
    ...currentReplyInfo,
    replyToPeerId,
    type: 'message',
  };

  moveReplyToNewDraft(global, threadId, newReply, toChatId);
  actions.openChat({ id: toChatId, tabId });
  actions.closeMediaViewer({ tabId });
  actions.exitMessageSelectMode({ tabId });
  actions.clearDraft({ chatId: currentChatId, threadId: currentThreadId });
});

addActionHandler('setForwardChat', async (global, actions, payload): Promise<void> => {
  const { chatId, tabId = getCurrentTabId() } = payload;
  const user = selectUser(global, chatId);
  const isSelectForwardsContainVoiceMessages = selectForwardsContainVoiceMessages(global, tabId);
  if (isSelectForwardsContainVoiceMessages && user && !await checkIfVoiceMessagesAllowed(global, user, chatId)) {
    actions.showDialog({
      data: {
        type: 'localized',
        text: {
          key: 'NoVoiceMessagesAllowed',
          variables: {
            user: getUserFullName(getTranslationFn(), user),
          },
          options: {
            withNodes: true,
            withMarkdown: true,
          },
        },
      },
      tabId,
    });
    return;
  }
  global = getGlobal();

  if (!selectForwardsCanBeSentToChat(global, chatId, tabId)) {
    actions.showAllowedMessageTypesNotification({ chatId, tabId });
    return;
  }

  global = updateTabState(global, {
    forwardMessages: {
      ...selectTabState(global, tabId).forwardMessages,
      toChatId: chatId,
    },
    isShareMessageModalShown: false,
  }, tabId);
  setGlobal(global);
  actions.openChat({ id: chatId, tabId });
  actions.closeMediaViewer({ tabId });
  actions.exitMessageSelectMode({ tabId });
});

addActionHandler('forwardToSavedMessages', (global, actions, payload): ActionReturnType => {
  const { scheduledAt, tabId = getCurrentTabId() } = payload || {};
  global = updateTabState(global, {
    forwardMessages: {
      ...selectTabState(global, tabId).forwardMessages,
      toChatId: global.currentUserId,
    },
  }, tabId);
  setGlobal(global);

  actions.exitMessageSelectMode({ tabId });
  actions.forwardMessages({ isSilent: true, scheduledAt, tabId });
});

interface ForwardToChatOptions {
  global: GlobalState;
  fromChat: ApiChat;
  toChat: ApiChat;
  toThreadId?: ThreadId;
  messages: ApiMessage[];
  comment?: string;
  withMyScore?: boolean;
  noAuthors?: boolean;
  noCaptions?: boolean;
}

function forwardMessagesToChat({
  global,
  fromChat,
  toChat,
  toThreadId = MAIN_THREAD_ID,
  messages,
  comment,
  withMyScore,
  noAuthors,
  noCaptions,
}: ForwardToChatOptions) {
  const privateForwardName = selectUserFullInfo(global, fromChat.id)?.privateForwardName;
  const threadInfo = toThreadId !== MAIN_THREAD_ID ? selectThreadInfo(global, toChat.id, toThreadId) : undefined;
  const lastMessageId = toThreadId === MAIN_THREAD_ID
    ? selectChatLastMessageId(global, toChat.id)
    : threadInfo?.lastMessageId;
  const targetMessageList = {
    chatId: toChat.id,
    threadId: toThreadId,
    type: 'thread',
  } as const;

  if (comment) {
    sendMessage(global, {
      chat: toChat,
      messageList: targetMessageList,
      text: comment,
      lastMessageId,
    });
  }

  if (messages.length) {
    const [ephemeralMessages, regularMessages] = partition(messages, (message) => message.isEphemeral);
    const messageGroups = [regularMessages, ephemeralMessages].filter((group) => group.length);

    for (const messagesToForward of messageGroups) {
      const messageSlices = global.config?.maxForwardedCount
        ? splitMessagesForForwarding(messagesToForward, global.config.maxForwardedCount)
        : [messagesToForward];

      for (const slice of messageSlices) {
        const forwardParams: ForwardMessagesParams = {
          fromChat,
          toChat,
          toThreadId,
          messages: slice,
          isSilent: true,
          withMyScore,
          noAuthors,
          noCaptions,
          privateForwardName,
          wasDrafted: false,
          lastMessageId,
        };

        callApi('forwardMessages', forwardParams);
      }
    }
  }
}

addActionHandler('forwardToMultipleChats', (global, actions, payload): ActionReturnType => {
  const { targets, comment, tabId = getCurrentTabId() } = payload;

  const {
    fromChatId, messageIds, withMyScore, noAuthors, noCaptions,
  } = selectTabState(global, tabId).forwardMessages;

  const fromChat = fromChatId ? selectChat(global, fromChatId) : undefined;

  const messages = fromChatId && messageIds
    ? messageIds
      .sort((a, b) => a - b)
      .map((id) => selectChatMessageOrEphemeral(global, fromChatId, id)).filter(Boolean)
    : undefined;

  if (!fromChat || !messages?.length) {
    return;
  }

  const forwardableMessages = messages.filter((message) => selectCanForwardMessage(global, message));

  if (!forwardableMessages.length) {
    return;
  }

  for (const { chatId } of targets) {
    const toChat = selectChat(global, chatId);
    if (!toChat) continue;

    forwardMessagesToChat({
      global,
      fromChat,
      toChat,
      messages: forwardableMessages,
      comment,
      withMyScore,
      noAuthors,
      noCaptions,
    });
  }

  global = updateTabState(global, {
    forwardMessages: {},
    isShareMessageModalShown: false,
  }, tabId);

  actions.exitMessageSelectMode({ tabId });

  return global;
});

addActionHandler('forwardStory', (global, actions, payload): ActionReturnType => {
  const { toChatId, tabId = getCurrentTabId() } = payload || {};

  const { fromChatId, storyId } = selectTabState(global, tabId).forwardMessages;
  const fromChat = fromChatId ? selectChat(global, fromChatId) : undefined;
  const toChat = toChatId ? selectChat(global, toChatId) : undefined;
  const story = fromChatId && storyId
    ? selectPeerStory(global, fromChatId, storyId)
    : undefined;

  if (!fromChat || !toChat || !story || 'isDeleted' in story) {
    return;
  }

  const lastMessageId = selectChatLastMessageId(global, toChatId);

  const { text, entities } = (story as ApiStory).content.text || {};
  void sendMessage(global, {
    chat: toChat,
    text,
    entities,
    story,
    lastMessageId,
  });

  global = getGlobal();
  global = updateTabState(global, {
    forwardMessages: {},
    isShareMessageModalShown: false,
  }, tabId);
  setGlobal(global);
});

addActionHandler('forwardAudio', (global, actions, payload): ActionReturnType => {
  const {
    toChatId, toThreadId = MAIN_THREAD_ID, tabId = getCurrentTabId(),
  } = payload;

  const { audioItem } = selectTabState(global, tabId).forwardMessages;
  const toChat = selectChat(global, toChatId);
  if (!toChat || !audioItem) {
    return;
  }

  const media = selectPlaybackMedia(global, audioItem);
  const audio = media?.mediaType === 'audio' ? media : undefined;
  const canForward = audioItem.type !== 'message'
    || selectCanForwardMessages(global, audioItem.chatId, [audioItem.messageId]);
  if (!audio || !canForward) {
    return;
  }

  const lastMessageId = selectChatLastMessageId(global, toChatId);
  const topicId = typeof toThreadId === 'number' && toThreadId !== MAIN_THREAD_ID ? toThreadId : undefined;
  void sendMessage(global, {
    chat: toChat,
    audio,
    lastMessageId,
    replyInfo: topicId ? { type: 'message', replyToMsgId: topicId, replyToTopId: topicId } : undefined,
  });

  actions.showNotification({
    message: toChatId === global.currentUserId ? {
      key: 'AudioForwardedToNoteToSelf',
      options: { withNodes: true, withMarkdown: true },
    } : { key: 'AudioForwardedToChat' },
    tabId,
  });

  global = getGlobal();
  global = updateTabState(global, {
    forwardMessages: {},
    isShareMessageModalShown: false,
  }, tabId);
  setGlobal(global);
});

addActionHandler('sendAudioToSavedMessages', (global, actions, payload): ActionReturnType => {
  const { audio, tabId = getCurrentTabId() } = payload;

  const chat = selectChat(global, global.currentUserId!);
  if (!chat) return;

  void sendMessage(global, {
    chat,
    audio,
    lastMessageId: selectChatLastMessageId(global, chat.id),
  });

  actions.showNotification({
    message: { key: 'AudioForwardedToNoteToSelf', options: { withNodes: true, withMarkdown: true } },
    tabId,
  });
});

// https://github.com/telegramdesktop/tdesktop/blob/11906297d82b6ff57b277da5251d2e6eb3d8b6d0/Telegram/SourceFiles/api/api_views.cpp#L22
const SEND_VIEWS_TIMEOUT = 1000;
let viewsIncrementTimeout: number | undefined;
let idsToIncrementViews: Record<string, Set<number>> = {};

function incrementViews() {
  if (viewsIncrementTimeout) {
    clearTimeout(viewsIncrementTimeout);
    viewsIncrementTimeout = undefined;
  }

  const { loadMessageViews } = getActions();
  Object.entries(idsToIncrementViews).forEach(([chatId, ids]) => {
    loadMessageViews({ chatId, ids: Array.from(ids), shouldIncrement: true });
  });

  idsToIncrementViews = {};
}
addActionHandler('scheduleForViewsIncrement', (global, actions, payload): ActionReturnType => {
  const { ids, chatId } = payload;

  if (!viewsIncrementTimeout) {
    setTimeout(incrementViews, SEND_VIEWS_TIMEOUT);
  }

  if (!idsToIncrementViews[chatId]) {
    idsToIncrementViews[chatId] = new Set();
  }

  ids.forEach((id) => {
    idsToIncrementViews[chatId].add(id);
  });
});

addActionHandler('loadMessageViews', async (global, actions, payload): Promise<void> => {
  const { chatId, ids, shouldIncrement } = payload;

  if (selectIsCurrentUserFrozen(global)) return;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  const result = await callApi('fetchMessageViews', {
    chat,
    ids,
    shouldIncrement,
  });

  if (!result) return;

  global = getGlobal();
  result.viewsInfo.forEach((update: {
    id: number; views?: number; forwards?: number; threadInfo?: ApiThreadInfo;
  }) => {
    global = updateChatMessage(global, chatId, update.id, {
      viewsCount: update.views,
      forwardsCount: update.forwards,
    }, true);

    if (update.threadInfo) {
      global = updateThreadInfo(global, update.threadInfo);
    }
  });

  setGlobal(global);
});

addActionHandler('loadFactChecks', async (global, actions, payload): Promise<void> => {
  const { chatId, ids } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  const result = await callApi('fetchFactChecks', {
    chat,
    ids,
  });

  if (!result) return;

  global = getGlobal();
  result.forEach((factCheck: ApiFactCheck, i: number) => {
    global = updateChatMessage(global, chatId, ids[i], {
      factCheck,
    });
  });

  setGlobal(global);
});

addActionHandler('loadOutboxReadDate', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return;

  try {
    const result = await callApi('fetchOutboxReadDate', { chat, messageId });
    if (result?.date) {
      global = getGlobal();
      global = updateChatMessage(global, chatId, messageId, { readDate: result.date });
      setGlobal(global);
    }
  } catch (error) {
    const { message } = error as ApiError;

    if (message === 'USER_PRIVACY_RESTRICTED' || message === 'YOUR_PRIVACY_RESTRICTED') {
      global = getGlobal();

      const user = selectUser(global, chatId);
      if (!user) return;
      const userStatus = selectUserStatus(global, chatId);
      if (!userStatus) return;

      const updateStatus = message === 'USER_PRIVACY_RESTRICTED'
        ? { isReadDateRestricted: true }
        : { isReadDateRestrictedByMe: true };

      global = replaceUserStatuses(global, {
        [chatId]: { ...userStatus, ...updateStatus },
      });
      // Need to reset `readDate` to `undefined` after click on "Show my Read Time" button
      global = updateChatMessage(global, chatId, messageId, { readDate: undefined });
      setGlobal(global);
    }
  }
});

function countSortedIds(ids: number[], from: number, to: number) {
  // If ids are outside viewport, we cannot get correct count
  if (ids.length === 0 || from < ids[0] || to > ids[ids.length - 1]) return undefined;

  let count = 0;

  for (let i = 0, l = ids.length; i < l; i++) {
    if (ids[i] >= from && ids[i] <= to) {
      count++;
    }

    if (ids[i] >= to) {
      break;
    }
  }

  return count;
}

function splitAttachmentsByType(attachments: ApiAttachment[]) {
  return attachments.reduce((acc, attachment, index, arr) => {
    if (index === 0) {
      acc.push([attachment]);
      return acc;
    }

    // GIFs are never grouped, so each one stays a separate message in its place
    const type = getAttachmentType(attachment);
    const previousType = getAttachmentType(arr[index - 1]);
    if (type === previousType && type !== 'gif') {
      acc[acc.length - 1].push(attachment);
    } else {
      acc.push([attachment]);
    }

    return acc;
  }, [] as ApiAttachment[][]);
}

function getIsMediaGroup(group: ApiAttachment[]) {
  return Boolean(group[0].quick && !group[0].shouldSendAsFile);
}

function getAttachmentType(attachment: ApiAttachment) {
  const {
    shouldSendAsFile, mimeType,
  } = attachment;
  if (SUPPORTED_AUDIO_CONTENT_TYPES.has(mimeType)) return 'audio';
  if (shouldSendAsFile) return 'file';
  if (mimeType === GIF_MIME_TYPE || attachment.shouldSendAsGif || attachment.gif) return 'gif';
  if (SUPPORTED_PHOTO_CONTENT_TYPES.has(mimeType) || SUPPORTED_VIDEO_CONTENT_TYPES.has(mimeType)) return 'media';
  if (attachment.voice) return 'voice';
  return 'file';
}

addActionHandler('markMentionsRead', (global, actions, payload): ActionReturnType => {
  const { chatId, messageIds } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  global = removeUnreadMentions({
    global,
    chatId,
    ids: messageIds,
  });
  setGlobal(global);

  actions.markMessagesRead({ chatId, messageIds });
});

addActionHandler('focusNextMention', (global, actions, payload): ActionReturnType => {
  const { chatId, threadId = MAIN_THREAD_ID, tabId = getCurrentTabId() } = payload;

  const nextMentionId = selectThreadReadState(global, chatId, threadId)?.unreadMentions?.[0];
  if (!nextMentionId) return;

  actions.focusMessage({ chatId, messageId: nextMentionId, tabId });
});

addActionHandler('readAllMentions', (global, actions, payload): ActionReturnType => {
  const { chatId, threadId = MAIN_THREAD_ID } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) return undefined;

  return updateThreadReadState(global, chatId, threadId, {
    unreadMentionsCount: 0,
    unreadMentions: undefined,
  });
});
