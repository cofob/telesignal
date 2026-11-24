import type { ClipboardTextFormat, MessageCopyRequest } from '../../../types/messageCopy';
import type {
  ActionReturnType,
} from '../../types';
import { MAIN_THREAD_ID } from '../../../api/types';
import { type ActiveDownloads, FocusDirection } from '../../../types';

import {
  ANIMATION_END_DELAY,
  FORWARD_MESSAGES_MAX,
  SCROLL_MAX_DURATION,
} from '../../../config';
import { cancelScrollBlockingAnimation, isAnimatingScroll } from '../../../util/animateScroll';
import { areDeepEqual } from '../../../util/areDeepEqual';
import { getState as getPlaybackState, stop as stopPlayback } from '../../../util/audioPlayback/playbackController';
import { IS_TOUCH_ENV } from '../../../util/browser/windowEnvironment';
import { copyTextToClipboard, copyTextToClipboardFromPromise } from '../../../util/clipboard';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { compact } from '../../../util/iteratees';
import { clearMediaSession } from '../../../util/mediaSession';
import { Bundles, loadBundle } from '../../../util/moduleLoader';
import { openSavedFile, revealSavedFile } from '../../../util/tauri/nativeFiles';
import {
  getMediaFilename,
  getMediaFormat,
  getMediaHash,
} from '../../helpers';
import { addTabStateResetterAction } from '../../helpers/meta';
import {
  addActionHandler, getActions, getGlobal, setGlobal,
} from '../../index';
import {
  addActiveMediaDownload,
  cancelMessageMediaDownload,
  enterMessageSelectMode,
  exitMessageSelectMode,
  toggleMessageSelection,
  updateChatMessage,
  updateFocusedMessage,
  updateSavedFiles,
} from '../../reducers';
import { pushPlayedTrack } from '../../reducers/audioPlayer';
import { updateTabState } from '../../reducers/tabs';
import { replaceTabThreadParam, replaceThreadLocalStateParam, updateThreadReadState } from '../../reducers/threads';
import {
  selectAlbumMessageIdToEdit,
  selectAllowedMessageActionsSlow,
  selectCanForwardMessage,
  selectCanForwardMessages,
  selectChat,
  selectChatLastMessageId,
  selectChatMessage,
  selectChatMessages,
  selectCurrentChat,
  selectCurrentMessageList,
  selectForwardedMessageIdsByGroupId,
  selectIsRightColumnShown,
  selectIsViewportNewest,
  selectMessageIdsByGroupId,
  selectTabState,
  selectViewportIds,
} from '../../selectors';
import {
  makeMessageTrackKeyFrom, selectCurrentPlaylistKey, selectPlaybackRoundVideo,
} from '../../selectors/audioPlayer';
import { selectMessageDownloadableMedia } from '../../selectors/media';
import { selectDraft, selectReplyStack, selectThreadInfo } from '../../selectors/threads';

import { getIsMobile } from '../../../hooks/useAppLayout';

const FOCUS_DURATION = 1500;
const FOCUS_NO_HIGHLIGHT_DURATION = SCROLL_MAX_DURATION + ANIMATION_END_DELAY;
const POLL_RESULT_OPEN_DELAY_MS = 450;

let blurTimeout: number | undefined;

addActionHandler('setScrollOffset', (global, actions, payload): ActionReturnType => {
  const {
    chatId, threadId, scrollOffset, tabId = getCurrentTabId(),
  } = payload;

  global = replaceThreadLocalStateParam(global, chatId, threadId, 'lastScrollOffset', scrollOffset);

  return replaceTabThreadParam(global, chatId, threadId, 'scrollOffset', scrollOffset, tabId);
});

addActionHandler('clickRichButton', (global, actions, payload): ActionReturnType => {
  const {
    chatId, messageId, threadId, action, tabId = getCurrentTabId(),
  } = payload;

  switch (action.type) {
    case 'url':
      actions.openUrl({
        url: action.url,
        linkContext: chatId && messageId !== undefined ? { type: 'message', chatId, messageId, threadId } : undefined,
        tabId,
      });
      break;
    case 'copy':
      copyTextToClipboard(action.copyText);
      actions.showNotification({
        message: {
          key: 'ExactTextCopied',
          variables: { text: action.copyText },
          options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
        },
        tabId,
      });
      break;
    case 'userProfile':
      actions.openChatWithInfo({ id: action.userId, tabId });
      break;
  }
});

addActionHandler('setEditingId', (global, actions, payload): ActionReturnType => {
  const { messageId, tabId = getCurrentTabId() } = payload;
  if (messageId !== undefined && selectTabState(global, tabId).richMediaUploadBlockingCount) {
    return;
  }

  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return undefined;
  }

  const { chatId, threadId, type } = currentMessageList;
  const paramName = type === 'scheduled' ? 'editingScheduledId' : 'editingId';

  return replaceThreadLocalStateParam(global, chatId, threadId, paramName, messageId);
});

addActionHandler('markTypingDraftDone', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId } = payload;
  const message = selectChatMessage(global, chatId, messageId);
  if (!message?.isTypingDraft) {
    return undefined;
  }

  return updateChatMessage(global, chatId, messageId, { isTypingDraft: undefined });
});

addActionHandler('setEditingDraft', (global, actions, payload): ActionReturnType => {
  const {
    draft, chatId, threadId, type,
  } = payload;

  const paramName = type === 'scheduled' ? 'editingScheduledDraft' : 'editingDraft';

  return replaceThreadLocalStateParam(global, chatId, threadId, paramName, draft);
});

addActionHandler('editLastMessage', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const { chatId, threadId } = selectCurrentMessageList(global, tabId) || {};
  if (!chatId || !threadId) {
    return undefined;
  }

  const chatMessages = selectChatMessages(global, chatId);
  const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
  if (!chatMessages || !viewportIds) {
    return undefined;
  }

  const lastOwnEditableMessageId = viewportIds.findLast((id) => {
    return Boolean(chatMessages[id] && selectAllowedMessageActionsSlow(global, chatMessages[id], threadId).canEdit);
  });

  if (!lastOwnEditableMessageId) {
    return undefined;
  }

  const lastOwnEditableMessage = chatMessages[lastOwnEditableMessageId];
  const messageId = lastOwnEditableMessage.isInAlbum
    ? selectAlbumMessageIdToEdit(global, lastOwnEditableMessage)
    : lastOwnEditableMessageId;

  actions.startEditingMessage({ messageId, tabId });
  return undefined;
});

addActionHandler('replyToNextMessage', (global, actions, payload): ActionReturnType => {
  const { targetIndexDelta, tabId = getCurrentTabId() } = payload;
  const { chatId, threadId } = selectCurrentMessageList(global, tabId) || {};
  if (!chatId || !threadId) {
    return;
  }

  const chatMessages = selectChatMessages(global, chatId);
  const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
  if (!chatMessages || !viewportIds) {
    return;
  }

  const replyInfo = selectDraft(global, chatId, threadId)?.replyInfo;
  if (replyInfo?.type === 'ephemeral') return;

  const isLatest = selectIsViewportNewest(global, chatId, threadId, tabId);

  let messageId: number | undefined;

  if (!isLatest || !replyInfo?.replyToMsgId) {
    if (threadId === MAIN_THREAD_ID) {
      messageId = selectChatLastMessageId(global, chatId);
    } else {
      const threadInfo = selectThreadInfo(global, chatId, threadId);

      messageId = threadInfo?.lastMessageId;
    }
  } else {
    const chatMessageKeys = Object.keys(chatMessages);
    const indexOfCurrent = chatMessageKeys.indexOf(replyInfo.replyToMsgId.toString());
    const newIndex = indexOfCurrent + targetIndexDelta;
    messageId = newIndex <= chatMessageKeys.length + 1 && newIndex >= 0
      ? Number(chatMessageKeys[newIndex])
      : undefined;
  }
  actions.updateDraftReplyInfo({
    replyToMsgId: messageId, replyToPeerId: undefined,
    quoteText: undefined, quoteRich: undefined, quoteOffset: undefined, tabId,
  });
  actions.focusMessage({
    chatId,
    threadId,
    messageId: messageId!,
    tabId,
  });
});

addActionHandler('openAudioPlayer', (global, actions, payload): ActionReturnType => {
  const {
    item, source, playbackRate, isMuted, timestamp,
    tabId = getCurrentTabId(),
  } = payload;

  const tabState = selectTabState(global, tabId);

  const effectiveSource = source ?? tabState.audioPlayer.source;
  const hasSourceChanged = !areDeepEqual(tabState.audioPlayer.source, effectiveSource);

  if (global.audioPlayer.orderMode === 'shuffle' && (hasSourceChanged || !tabState.audioPlayer.shuffle)) {
    actions.loadShufflePlaylist({ tabId });
  }

  if (effectiveSource?.type === 'chat' && item?.type === 'message') {
    actions.searchChatMediaMessages({
      chatId: effectiveSource.chatId,
      threadId: effectiveSource.threadId,
      mediaType: effectiveSource.mediaType,
      currentMediaMessageId: item.messageId,
      tabId,
    });
  }

  // A partial rich message lists only some of its tracks
  if (item?.type === 'message' && item.documentId && !item.isScheduled) {
    const { chatId, messageId } = item;
    if (selectChatMessage(global, chatId, messageId)?.content.richMessage?.isPart) {
      actions.loadRichMessage({ chatId, messageId });
    }
  }

  global = updateTabState(global, {
    audioPlayer: {
      ...selectTabState(global, tabId).audioPlayer,
      activeItem: item,
      timestamp,
      source: effectiveSource,
      playbackRate: playbackRate || tabState.audioPlayer.playbackRate || global.audioPlayer.lastPlaybackRate,
      isPlaybackRateActive: (tabState.audioPlayer.isPlaybackRateActive === undefined
        ? global.audioPlayer.isLastPlaybackRateActive
        : tabState.audioPlayer.isPlaybackRateActive),
      isMuted: isMuted || tabState.audioPlayer.isMuted,
      shuffle: hasSourceChanged ? undefined : selectTabState(global, tabId).audioPlayer.shuffle,
      pendingStep: undefined,
      // Only consecutive round videos keep the enlarged or detached player
      roundVideoMode: selectPlaybackRoundVideo(global, item) ? tabState.audioPlayer.roundVideoMode : undefined,
    },
  }, tabId);

  if (global.audioPlayer.orderMode === 'shuffle' && !hasSourceChanged && tabState.audioPlayer.shuffle) {
    const playedKey = selectCurrentPlaylistKey(global, tabId);
    if (playedKey !== undefined) {
      global = pushPlayedTrack(global, playedKey, tabId);
    }
  }

  return global;
});

addActionHandler('setAudioPlayerVolume', (global, actions, payload): ActionReturnType => {
  const {
    volume, tabId = getCurrentTabId(),
  } = payload;

  global = updateTabState(global, {
    audioPlayer: {
      ...selectTabState(global, tabId).audioPlayer,
      isMuted: false,
    },
  }, tabId);
  global = {
    ...global,
    audioPlayer: {
      ...global.audioPlayer,
      volume,
    },
  };
  return global;
});

addActionHandler('setAudioPlayerPlaybackRate', (global, actions, payload): ActionReturnType => {
  const {
    playbackRate, isPlaybackRateActive, tabId = getCurrentTabId(),
  } = payload;

  global = {
    ...global,
    audioPlayer: {
      ...global.audioPlayer,
      lastPlaybackRate: playbackRate,
      isLastPlaybackRateActive: isPlaybackRateActive,
    },
  };

  return updateTabState(global, {
    audioPlayer: {
      ...selectTabState(global, tabId).audioPlayer,
      playbackRate,
      isPlaybackRateActive,
    },
  }, tabId);
});

addActionHandler('setAudioPlayerMuted', (global, actions, payload): ActionReturnType => {
  const {
    isMuted, tabId = getCurrentTabId(),
  } = payload;

  return updateTabState(global, {
    audioPlayer: {
      ...selectTabState(global, tabId).audioPlayer,
      isMuted,
    },
  }, tabId);
});

addActionHandler('closeAudioPlayer', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);

  if (tabId === getCurrentTabId()) {
    stopPlayback();
    clearMediaSession();
  }

  return updateTabState(global, {
    audioPlayer: {
      playbackRate: tabState.audioPlayer.playbackRate,
      isPlaybackRateActive: tabState.audioPlayer.isPlaybackRateActive,
      isMuted: tabState.audioPlayer.isMuted,
      source: tabState.audioPlayer.source,
    },
    isAudioPlaylistModalOpen: undefined,
  }, tabId);
});

addActionHandler('openPollResults', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  const shouldOpenInstantly = selectIsRightColumnShown(global, getIsMobile(), tabId);
  const tabState = selectTabState(global, tabId);

  if (!shouldOpenInstantly) {
    window.setTimeout(() => {
      global = getGlobal();

      global = updateTabState(global, {
        pollResults: {
          chatId,
          messageId,
          votesByOption: {},
        },
      }, tabId);
      setGlobal(global);
    }, POLL_RESULT_OPEN_DELAY_MS);
  } else if (chatId !== tabState.pollResults.chatId || messageId !== tabState.pollResults.messageId) {
    return updateTabState(global, {
      pollResults: {
        chatId,
        messageId,
        votesByOption: {},
      },
    }, tabId);
  }

  return undefined;
});

addActionHandler('closePollResults', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  return updateTabState(global, {
    pollResults: {},
  }, tabId);
});

addActionHandler('focusNextReply', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return undefined;
  }

  const { chatId, threadId } = currentMessageList;

  const replyStack = selectReplyStack(global, chatId, threadId, tabId);

  if (!replyStack || replyStack.length === 0) {
    actions.scrollMessageListToBottom({ tabId });
  } else {
    const messageId = replyStack.pop();

    global = replaceTabThreadParam(global, chatId, threadId, 'replyStack', [...replyStack], tabId);

    setGlobal(global);

    actions.focusMessage({
      chatId,
      threadId,
      messageId: messageId!,
      tabId,
    });
  }

  return undefined;
});

addActionHandler('focusMessage', (global, actions, payload): ActionReturnType => {
  const {
    chatId, threadId = MAIN_THREAD_ID, messageListType = 'thread', noHighlight, groupedId, groupedChatId,
    replyMessageId, isResizingContainer, shouldReplaceHistory, quote, quoteOffset,
    scrollTargetPosition, timestamp, pollOption, tabId = getCurrentTabId(),
  } = payload;

  let { messageId } = payload;

  const chat = selectChat(global, chatId);
  if (!chat) {
    actions.showNotification({ message: { key: 'ErrorFocusInaccessibleMessage' }, tabId });
    return undefined;
  }

  const onMessageReady = timestamp
    ? () => actions.openMediaFromTimestamp({
      chatId, threadId, messageId, timestamp, tabId,
    }) : undefined;

  if (groupedId !== undefined) {
    const ids = selectForwardedMessageIdsByGroupId(global, groupedChatId!, groupedId);
    if (ids?.length) {
      ([messageId] = compact(ids));
    }
  }

  const currentMessageList = selectCurrentMessageList(global, tabId);
  const shouldSwitchChat = !currentMessageList || (
    chatId !== currentMessageList.chatId
    || threadId !== currentMessageList.threadId
    || messageListType !== currentMessageList.type
  );

  if (blurTimeout) {
    clearTimeout(blurTimeout);
    blurTimeout = undefined;
  }
  blurTimeout = window.setTimeout(() => {
    global = getGlobal();
    global = updateFocusedMessage(global, undefined, tabId);
    setGlobal(global);
  }, noHighlight ? FOCUS_NO_HIGHLIGHT_DURATION : FOCUS_DURATION);

  global = updateFocusedMessage(global, {
    chatId,
    messageId,
    threadId,
    noHighlight,
    isResizingContainer,
    quote,
    quoteOffset,
    pollOption,
    scrollTargetPosition,
    direction: undefined,
  }, tabId);

  if (replyMessageId) {
    const replyStack = selectReplyStack(global, chatId, threadId, tabId) || [];
    global = replaceTabThreadParam(global, chatId, threadId, 'replyStack', [...replyStack, replyMessageId], tabId);
  }

  if (shouldSwitchChat) {
    global = updateFocusedMessage(global, { direction: FocusDirection.Static }, tabId);
  }

  const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
  if (viewportIds && viewportIds.includes(messageId)) {
    setGlobal(global, { forceOnHeavyAnimation: true });
    actions.openChat({
      id: chatId,
      type: messageListType,
      shouldReplaceHistory,
      tabId,
    });
    onMessageReady?.();
    return undefined;
  }

  if (shouldSwitchChat) {
    global = replaceTabThreadParam(global, chatId, threadId, 'viewportIds', undefined, tabId);
  }

  if (viewportIds && !shouldSwitchChat) {
    const direction = messageId > viewportIds[0] ? FocusDirection.Down : FocusDirection.Up;
    global = updateFocusedMessage(global, { direction }, tabId);
  }

  if (isAnimatingScroll()) {
    cancelScrollBlockingAnimation();
  }

  setGlobal(global, { forceOnHeavyAnimation: true });

  actions.openChat({
    id: chatId,
    type: messageListType,
    shouldReplaceHistory,
    tabId,
  });
  actions.loadViewportMessages({
    chatId,
    threadId,
    tabId,
    shouldForceRender: true,
    onLoaded: onMessageReady,
  });
  return undefined;
});

addActionHandler('scrollMessageListToBottom', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return;
  }

  const { chatId, threadId } = currentMessageList;

  global = updateFocusedMessage(global, {
    chatId,
    threadId,
    messageId: undefined,
    scrollTargetPosition: 'end',
    direction: FocusDirection.Down,
    noHighlight: true,
  }, tabId);

  setGlobal(global, { forceOnHeavyAnimation: true });

  // Reuse part of `focusMessage`
  if (blurTimeout) {
    clearTimeout(blurTimeout);
    blurTimeout = undefined;
  }
  blurTimeout = window.setTimeout(() => {
    global = getGlobal();
    global = updateFocusedMessage(global, undefined, tabId);
    global = updateThreadReadState(global, chatId, threadId, { unreadCount: 0 });
    setGlobal(global);
  }, FOCUS_NO_HIGHLIGHT_DURATION);

  if (isAnimatingScroll()) {
    cancelScrollBlockingAnimation();
  }

  const isViewportNewest = selectIsViewportNewest(global, chatId, threadId, tabId);
  if (isViewportNewest) {
    return;
  }

  actions.loadViewportMessages({
    chatId,
    threadId,
    tabId,
    shouldForceRender: true,
    forceLastSlice: true,
  });
});

addActionHandler('setShouldPreventComposerAnimation', (global, actions, payload): ActionReturnType => {
  const { shouldPreventComposerAnimation, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, {
    shouldPreventComposerAnimation,
  }, tabId);
});

addActionHandler('setIsRichInputExpanded', (global, actions, payload): ActionReturnType => {
  const { isRichInputExpanded, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, {
    isRichInputExpanded,
  }, tabId);
});

addActionHandler('requestRichInputMedia', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId(), ...request } = payload;
  return updateTabState(global, {
    requestedRichInputMedia: request,
  }, tabId);
});

addTabStateResetterAction('resetRichInputMediaRequest', 'requestedRichInputMedia');

addActionHandler('changeRichMediaUploadBlocking', (global, actions, payload): ActionReturnType => {
  const { delta, tabId = getCurrentTabId() } = payload;
  const currentCount = selectTabState(global, tabId).richMediaUploadBlockingCount || 0;
  const nextCount = Math.max(currentCount + delta, 0);
  return updateTabState(global, {
    richMediaUploadBlockingCount: nextCount || undefined,
  }, tabId);
});

addActionHandler('openReplyMenu', (global, actions, payload): ActionReturnType => {
  const {
    fromChatId, messageId, quoteText, quoteRich, quoteOffset, tabId = getCurrentTabId(),
  } = payload;
  return updateTabState(global, {
    replyingMessage: {
      fromChatId,
      messageId,
      quoteText,
      quoteRich,
      quoteOffset,
    },
    isShareMessageModalShown: true,
  }, tabId);
});

addActionHandler('openForwardMenu', (global, actions, payload): ActionReturnType => {
  const {
    fromChatId, messageIds, storyId, audioItem, groupedId, withMyScore, tabId = getCurrentTabId(),
  } = payload;
  let groupedMessageIds;
  if (groupedId) {
    groupedMessageIds = selectMessageIdsByGroupId(global, fromChatId, groupedId);
  }
  const resolvedMessageIds = groupedMessageIds || messageIds;
  if (resolvedMessageIds && !selectCanForwardMessages(global, fromChatId, resolvedMessageIds)) return;
  if (audioItem?.type === 'message' && !selectCanForwardMessages(global, audioItem.chatId, [audioItem.messageId])) {
    return;
  }

  return updateTabState(global, {
    forwardMessages: {
      fromChatId,
      messageIds: resolvedMessageIds,
      storyId,
      audioItem,
      withMyScore,
    },
    isShareMessageModalShown: true,
  }, tabId);
});

addActionHandler('changeRecipient', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  return updateTabState(global, {
    forwardMessages: {
      ...selectTabState(global, tabId).forwardMessages,
      toChatId: undefined,
      noAuthors: false,
      noCaptions: false,
    },
    isShareMessageModalShown: true,
  }, tabId);
});

addActionHandler('setForwardNoAuthors', (global, actions, payload): ActionReturnType => {
  const { noAuthors, tabId = getCurrentTabId() } = payload;
  const tabState = selectTabState(global, tabId);
  return updateTabState(global, {
    forwardMessages: {
      ...tabState.forwardMessages,
      noAuthors,
      // `noCaptions` cannot be true when `noAuthors` is false
      noCaptions: noAuthors && tabState.forwardMessages.noCaptions,
    },
  }, tabId);
});

addActionHandler('setForwardNoCaptions', (global, actions, payload): ActionReturnType => {
  const { noCaptions, tabId = getCurrentTabId() } = payload;
  return updateTabState(global, {
    forwardMessages: {
      ...selectTabState(global, tabId).forwardMessages,
      noCaptions,
      noAuthors: noCaptions, // On other clients `noAuthors` updates together with `noCaptions`
    },
  }, tabId);
});

addActionHandler('exitForwardMode', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  global = updateTabState(global, {
    isShareMessageModalShown: false,
    forwardMessages: {},
    replyingMessage: {},
  }, tabId);
  setGlobal(global);
});

addActionHandler('openForwardMenuForSelectedMessages', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);
  if (!tabState.selectedMessages) {
    return;
  }

  const { chatId: fromChatId, messageIds } = tabState.selectedMessages;

  const forwardableMessageIds = messageIds.filter((id) => {
    const message = selectChatMessage(global, fromChatId, id);
    return message && selectCanForwardMessage(global, message);
  });

  if (!forwardableMessageIds.length) {
    return;
  }

  if (forwardableMessageIds.length > FORWARD_MESSAGES_MAX) {
    actions.showNotification({
      message: { key: 'ForwardMessagesLimit', variables: { count: FORWARD_MESSAGES_MAX } },
      tabId,
    });
    return;
  }

  actions.openForwardMenu({ fromChatId, messageIds: forwardableMessageIds, tabId });
});

addActionHandler('cancelMediaDownload', (global, actions, payload): ActionReturnType => {
  const { media, tabId = getCurrentTabId() } = payload;

  const hash = getMediaHash(media, 'download');
  if (!hash) return undefined;

  global = cancelMessageMediaDownload(global, [hash], tabId);
  return global;
});

addActionHandler('cancelMediaHashDownloads', (global, actions, payload): ActionReturnType => {
  const { mediaHashes, tabId = getCurrentTabId() } = payload;

  global = cancelMessageMediaDownload(global, mediaHashes, tabId);

  return global;
});

addActionHandler('updateSavedFiles', (global, actions, payload): ActionReturnType => {
  const { added, removed, tabId = getCurrentTabId() } = payload;

  return updateSavedFiles(global, added, removed, tabId);
});

addActionHandler('openSavedFile', (global, actions, payload): ActionReturnType => {
  const { key, tabId = getCurrentTabId() } = payload;

  void openSavedFile(key, tabId);
});

addActionHandler('showSavedFileInFolder', (global, actions, payload): ActionReturnType => {
  const { key, tabId = getCurrentTabId() } = payload;

  void revealSavedFile(key, tabId);
});

addActionHandler('downloadMedia', (global, actions, payload): ActionReturnType => {
  const { media, originMessage, tabId = getCurrentTabId() } = payload;

  const hash = getMediaHash(media, 'download');
  if (!hash) return undefined;

  const size = 'size' in media ? media.size ?? 0 : 0;
  const metadata = {
    size,
    format: getMediaFormat(media, 'download'),
    filename: getMediaFilename(media),
    originChatId: originMessage?.chatId,
    originMessageId: originMessage?.id,
  } satisfies ActiveDownloads[string];

  return addActiveMediaDownload(global, hash, metadata, tabId);
});

addActionHandler('downloadSelectedMessages', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);
  if (!tabState.selectedMessages) {
    return;
  }

  const { chatId, messageIds } = tabState.selectedMessages;
  const { threadId } = selectCurrentMessageList(global, tabId) || {};

  const chatMessages = selectChatMessages(global, chatId);
  if (!chatMessages || !threadId) return;
  const messages = messageIds.map((id) => chatMessages[id])
    .filter((message) => selectAllowedMessageActionsSlow(global, message, threadId).canDownload);
  messages.forEach((message) => {
    const media = selectMessageDownloadableMedia(global, message);
    if (!media) return;
    actions.downloadMedia({ media, originMessage: message, tabId });
  });
});

addActionHandler('enterMessageSelectMode', (global, actions, payload): ActionReturnType => {
  const { messageId, tabId = getCurrentTabId() } = payload || {};
  const openChat = selectCurrentChat(global, tabId);
  if (!openChat) {
    return global;
  }

  return enterMessageSelectMode(global, openChat.id, messageId, tabId);
});

addActionHandler('toggleMessageSelection', (global, actions, payload): ActionReturnType => {
  const {
    messageId,
    groupedId,
    childMessageIds,
    withShift,
    tabId = getCurrentTabId(),
  } = payload;
  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return;
  }

  const { chatId, threadId, type: messageListType } = currentMessageList;

  global = toggleMessageSelection(
    global, chatId, threadId, messageListType, messageId, groupedId, childMessageIds, withShift, tabId,
  );

  setGlobal(global);

  if (global.shouldShowContextMenuHint) {
    actions.disableContextMenuHint();
    actions.showNotification({
      message: {
        key: IS_TOUCH_ENV ? 'ContextMenuHintTouch' : 'ContextMenuHintMouse',
      },
      tabId,
    });
  }
});

addActionHandler('disableContextMenuHint', (global): ActionReturnType => {
  if (!global.shouldShowContextMenuHint) {
    return undefined;
  }

  return {
    ...global,
    shouldShowContextMenuHint: false,
  };
});

addActionHandler('exitMessageSelectMode', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  return exitMessageSelectMode(global, tabId);
});

addActionHandler('openPollModal', (global, actions, payload): ActionReturnType => {
  const {
    chatId,
    threadId,
    messageListType,
    tabId = getCurrentTabId(),
  } = payload;
  const replyInfo = selectDraft(global, chatId, threadId ?? MAIN_THREAD_ID)?.replyInfo;
  if (replyInfo?.type === 'ephemeral') return;

  return updateTabState(global, {
    pollModal: {
      chatId,
      threadId,
      messageListType,
    },
  }, tabId);
});
addTabStateResetterAction('closePollModal', 'pollModal');

addActionHandler('openReactorListModal', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    reactorModal: { chatId, messageId },
  }, tabId);
});

addActionHandler('closeReactorListModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    reactorModal: undefined,
  }, tabId);
});

addActionHandler('openSeenByModal', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    seenByModal: { chatId, messageId },
  }, tabId);
});

addActionHandler('closeSeenByModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    seenByModal: undefined,
  }, tabId);
});

addActionHandler('openPrivacySettingsNoticeModal', (global, actions, payload): ActionReturnType => {
  const { chatId, isReadDate, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    privacySettingsNoticeModal: { chatId, isReadDate },
  }, tabId);
});

addActionHandler('closePrivacySettingsNoticeModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    privacySettingsNoticeModal: undefined,
  }, tabId);
});

addActionHandler('copySelectedMessages', (global, actions, payload): ActionReturnType => {
  const { shouldNotify, tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);
  const selectedMessages = tabState.selectedMessages;
  const messageList = selectCurrentMessageList(global, tabId);
  if (!selectedMessages?.messageIds.length || !messageList || messageList.chatId !== selectedMessages.chatId) {
    if (shouldNotify) actions.showNotification({ message: { key: 'GeneralError' }, tabId });
    return;
  }

  const { chatId, messageIds } = selectedMessages;
  copyTextForMessages({
    request: {
      type: 'messages',
      chatId,
      threadId: messageList.threadId,
      messageListType: messageList.type,
      messageIds,
      withSenderHeaders: true,
    },
    shouldNotify,
  }, tabId);
});

addActionHandler('copyMessagesByIds', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload;
  const { request } = payload;
  if (request.type === 'messages' && !request.messageIds.length) {
    if (payload.shouldNotify) actions.showNotification({ message: { key: 'GeneralError' }, tabId });
    return;
  }

  copyTextForMessages(payload, tabId);
});

addActionHandler('openOneTimeMediaModal', (global, actions, payload): ActionReturnType => {
  const { message, tabId = getCurrentTabId() } = payload;
  global = updateTabState(global, {
    oneTimeMediaModal: {
      message,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('closeOneTimeMediaModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const { oneTimeMediaModal } = selectTabState(global, tabId);
  if (
    tabId === getCurrentTabId() && oneTimeMediaModal
    && getPlaybackState().trackKey === makeMessageTrackKeyFrom(oneTimeMediaModal.message)
  ) {
    stopPlayback();
    clearMediaSession();
  }

  global = updateTabState(global, {
    oneTimeMediaModal: undefined,
  }, tabId);
  setGlobal(global);
});

function copyTextForMessages(
  payload: { request: MessageCopyRequest; shouldNotify?: boolean; textFormat?: ClipboardTextFormat },
  tabId: number,
) {
  const { showNotification } = getActions();
  const { request, shouldNotify, textFormat } = payload;
  const messageList = {
    chatId: request.chatId,
    threadId: request.threadId,
    type: request.messageListType,
  };

  const contentPromise = loadBundle(Bundles.Editor).then((bundle) => bundle.buildMessageCopyContent(
    messageList,
    request,
  ));

  void copyTextToClipboardFromPromise(
    contentPromise,
    shouldNotify ? () => showNotification({ message: { key: 'TextCopied' }, tabId }) : undefined,
    shouldNotify ? () => showNotification({ message: { key: 'GeneralError' }, tabId }) : undefined,
    textFormat,
  );
}

addActionHandler('openDeleteMessageModal', (global, actions, payload): ActionReturnType => {
  const {
    chatId, messageIds, isSchedule,
    tabId = getCurrentTabId(),
  } = payload;

  global = getGlobal();
  global = updateTabState(global, {
    deleteMessageModal: {
      chatId,
      messageIds,
      isSchedule,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('closeDeleteMessageModal', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    deleteMessageModal: undefined,
  }, tabId);
});

addActionHandler('openQuickPreview', (global, actions, payload): ActionReturnType => {
  const { id: chatId, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    quickPreview: { chatId },
  }, tabId);
});

addActionHandler('closeQuickPreview', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    quickPreview: undefined,
  }, tabId);
});
