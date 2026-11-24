import {
  memo, useEffect, useMemo, useRef,
  useUnmountCleanup,
} from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type {
  ApiKeyboardButton,
  ApiMessage,
  ApiPeer,
  ApiPhoto,
  ApiVideo,
  KeyboardButtonNoForwardsRequest,
} from '../../../api/types';
import type { ApiMessageAction } from '../../../api/types/messageActions';
import type {
  FocusDirection,
  ScrollTargetPosition,
  ThreadId,
} from '../../../types';
import type { Signal } from '../../../util/signals';
import { ApiMediaFormat } from '../../../api/types';
import { MediaViewerOrigin } from '../../../types';

import { MESSAGE_APPEARANCE_DELAY } from '../../../config';
import { getMediaHash, getMessageHtmlId } from '../../../global/helpers';
import { getMessageReplyInfo } from '../../../global/helpers/replies';
import {
  selectActionMessageBg,
  selectChatMessage,
  selectIsCurrentUserFrozen,
  selectIsInSelectMode,
  selectIsMessageFocused,
  selectSender,
  selectTabState,
} from '../../../global/selectors';
import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { IS_ANDROID, IS_FLUID_BACKGROUND_SUPPORTED } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import { fetch as fetchMedia } from '../../../util/mediaLoader';
import { getServerTime } from '../../../util/serverTime';
import { isElementInViewport } from '../../../util/visibility/isElementInViewport';
import { preventMessageInputBlur } from '../helpers/preventMessageInputBlur';

import useAppLayout from '../../../hooks/useAppLayout';
import useContextMenuHandlers from '../../../hooks/useContextMenuHandlers';
import useEnsureMessage from '../../../hooks/useEnsureMessage';
import useFlag from '../../../hooks/useFlag';
import { type ObserveFn, useOnIntersect } from '../../../hooks/useIntersectionObserver';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';
import useShowTransition from '../../../hooks/useShowTransition';
import useFluidBackgroundFilter from './hooks/useFluidBackgroundFilter';
import useFocusMessageListElement from './hooks/useFocusMessageListElement';

import ActionMessageText from './ActionMessageText';
import ChannelPhoto from './actions/ChannelPhoto';
import NoForwardsRequest from './actions/NoForwardsRequest';
import SuggestedBirthday from './actions/SuggestedBirthday';
import SuggestedPhoto from './actions/SuggestedPhoto';
import WallpaperPreview from './actions/WallpaperPreview';
import ContextMenuContainer from './ContextMenuContainer';
import InlineButtons from './InlineButtons';
import Reactions from './reactions/Reactions';

import styles from './ActionMessage.module.scss';

type OwnProps = {
  message: ApiMessage;
  threadId: ThreadId;
  appearanceOrder: number;
  isJustAdded?: boolean;
  isLastInList?: boolean;
  memoFirstUnreadIdRef?: { current: number | undefined };
  getIsMessageListReady?: Signal<boolean>;
  observeIntersectionForBottom?: ObserveFn;
  observeIntersectionForLoading?: ObserveFn;
  observeIntersectionForPlaying?: ObserveFn;
  onMessageUnmount?: (messageId: number) => void;
};

type StateProps = {
  actionMessageBg: string;
  sender?: ApiPeer;
  currentUserId?: string;
  isFocused?: boolean;
  focusDirection?: FocusDirection;
  noFocusHighlight?: boolean;
  replyMessage?: ApiMessage;
  isInSelectMode?: boolean;
  isResizingContainer?: boolean;
  scrollTargetPosition?: ScrollTargetPosition;
  isAccountFrozen?: boolean;
  noForwardsRequestExpirePeriod: number;
};

const SINGLE_LINE_ACTIONS = new Set<ApiMessageAction['type']>([
  'pinMessage',
  'chatEditPhoto',
  'chatDeletePhoto',
  'unsupported',
  'deleted',
  'viewOnce',
  'signalCall',
  'safetyNumberChange',
  'safetyNumberVerified',
]);
const HIDDEN_TEXT_ACTIONS = new Set<ApiMessageAction['type']>([
  'suggestProfilePhoto', 'suggestBirthday', 'noForwardsRequest',
]);
const WITH_LINK_BREAKS_ACTIONS = new Set<ApiMessageAction['type']>([
  'pollAppendAnswer',
  'pollDeleteAnswer',
]);

const ActionMessage = ({
  message,
  threadId,
  actionMessageBg,
  sender,
  currentUserId,
  appearanceOrder,
  isJustAdded,
  isLastInList,
  memoFirstUnreadIdRef,
  getIsMessageListReady,
  isFocused,
  focusDirection,
  noFocusHighlight,
  replyMessage,
  isInSelectMode,
  isResizingContainer,
  scrollTargetPosition,
  isAccountFrozen,
  noForwardsRequestExpirePeriod,
  observeIntersectionForBottom,
  observeIntersectionForLoading,
  observeIntersectionForPlaying,
  onMessageUnmount,
}: OwnProps & StateProps) => {
  const {
    openMediaViewer,
    showNotification,
    markMessagesRead,
    markMentionsRead,
    toggleNoForwards,
  } = getActions();

  const ref = useRef<HTMLDivElement>();

  const { id, chatId } = message;

  const isOpeningViewOnceRef = useRef(false);

  /**
   * Opens view-once media once, as Signal Desktop's `showLightboxForViewOnceMedia` (`ts/state/ducks/lightbox.preload.ts`)
   * does: the media is loaded, the message is marked viewed, which erases the media in the engine, and only then the
   * viewer shows the loaded copy, so closing the tab with the viewer open leaves nothing to open again
   */
  async function openViewOnceMedia(media: ApiPhoto | ApiVideo) {
    if (isOpeningViewOnceRef.current) return;
    isOpeningViewOnceRef.current = true;

    const hash = getMediaHash(media, 'full');
    const blobUrl = hash ? await fetchMedia(hash, ApiMediaFormat.BlobUrl) : undefined;
    if (!blobUrl) {
      isOpeningViewOnceRef.current = false;
      showNotification({ message: { key: 'ViewOnceLoadFailed' } });
      return;
    }

    markMessagesRead({ chatId, messageIds: [id] });
    openMediaViewer({
      standaloneMedia: [{ ...media, blobUrl }],
      origin: MediaViewerOrigin.ViewOnce,
      viewOnceMedia: { hash: hash!, blobUrl },
    });
  }
  const action = message.content.action!;

  const isTextHidden = HIDDEN_TEXT_ACTIONS.has(action.type)
    || (action.type === 'setChatWallpaper' && !action.isSame
      && Boolean(action.wallpaper?.document && !action.wallpaper.isPattern));
  const isSingleLine = SINGLE_LINE_ACTIONS.has(action.type);
  const withLinkBreaks = WITH_LINK_BREAKS_ACTIONS.has(action.type);
  const isFluidMultiline = IS_FLUID_BACKGROUND_SUPPORTED && !isSingleLine;

  const messageReplyInfo = getMessageReplyInfo(message);
  const { replyToMsgId, replyToPeerId } = messageReplyInfo || {};

  const withServiceReactions = Boolean(message.areReactionsPossible && message?.reactions?.results?.length);

  const hasNoForwardsRequestExpired = action.type === 'noForwardsRequest'
    && (message.date + noForwardsRequestExpirePeriod) <= getServerTime();
  const shouldRenderNoForwardsButtons = action.type === 'noForwardsRequest'
    && !message.isOutgoing && !action.isExpired && !hasNoForwardsRequestExpired;

  const lang = useLang();
  const { isTouchScreen } = useAppLayout();

  const noForwardsInlineButtons: KeyboardButtonNoForwardsRequest[][] = useMemo(() => [
    [
      {
        action: { type: 'noForwardsRequest', buttonType: 'reject' },
        text: lang('NoForwardsRequestReject'),
      },
      {
        action: { type: 'noForwardsRequest', buttonType: 'accept' },
        text: lang('NoForwardsRequestAccept'),
      },
    ],
  ], [lang]);

  const handleInlineButtonClick = useLastCallback((button: ApiKeyboardButton) => {
    if (button.action.type === 'noForwardsRequest') {
      if (action.type === 'noForwardsRequest') {
        const isAccept = button.action.buttonType === 'accept';
        toggleNoForwards({
          userId: chatId,
          isEnabled: isAccept ? action.newValue : action.prevValue,
          requestMsgId: id,
        });
      }
    }
  });

  useOnIntersect(ref, observeIntersectionForBottom);

  useEnsureMessage(
    replyToPeerId || chatId,
    replyToMsgId,
    replyMessage,
    id,
  );
  useFocusMessageListElement({
    elementRef: ref,
    isFocused,
    focusDirection,
    noFocusHighlight,
    isResizingContainer,
    isJustAdded,
    scrollTargetPosition,
  });

  const {
    isContextMenuOpen, contextMenuAnchor,
    handleBeforeContextMenu, handleContextMenu,
    handleContextMenuClose, handleContextMenuHide,
  } = useContextMenuHandlers(
    ref,
    (isTouchScreen && isInSelectMode) || isAccountFrozen,
    !IS_TAURI,
    IS_ANDROID,
    getIsMessageListReady,
  );
  const isContextMenuShown = contextMenuAnchor !== undefined;

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    preventMessageInputBlur(e);
    handleBeforeContextMenu(e);
  };

  const noAppearanceAnimation = appearanceOrder <= 0;
  const [isShown, markShown] = useFlag(noAppearanceAnimation);
  useEffect(() => {
    if (noAppearanceAnimation) {
      return;
    }

    // Message appearance animation works only if this timeout is not cleared
    setTimeout(markShown, appearanceOrder * MESSAGE_APPEARANCE_DELAY);
  }, [appearanceOrder, noAppearanceAnimation]);

  const { ref: refWithTransition } = useShowTransition({
    isOpen: isShown,
    noOpenTransition: noAppearanceAnimation,
    noCloseTransition: true,
    className: false,
    ref,
  });

  useUnmountCleanup(() => {
    onMessageUnmount?.(id);
  });

  useEffect(() => {
    const bottomMarker = ref.current;
    if (!bottomMarker || !isElementInViewport(bottomMarker)) return;

    if (message.hasUnreadMention) {
      markMentionsRead({ chatId, messageIds: [id] });
    }
  }, [
    chatId,
    id,
    message.hasUnreadMention,
  ]);

  const fluidBackgroundStyle = useFluidBackgroundFilter(isFluidMultiline ? actionMessageBg : undefined);

  const handleKeyDown = useLastCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  });

  const handleClick = useLastCallback(() => {
    switch (action.type) {
      // Signal Desktop `ts/components/conversation/Message.dom.tsx` (`#handleOpen` for tap-to-view messages)
      case 'viewOnce': {
        if (action.media) {
          void openViewOnceMedia(action.media);
        } else {
          showNotification({
            message: { key: message.isOutgoing ? 'ViewOnceOutgoingToast' : 'ViewOnceViewedToast' },
          });
        }
        break;
      }

      case 'chatEditPhoto': {
        openMediaViewer({
          chatId: message.chatId,
          messageId: message.id,
          threadId,
          origin: MediaViewerOrigin.ChannelAvatar,
        });
        break;
      }
    }
  });

  const fullContent = useMemo(() => {
    switch (action.type) {
      case 'setChatWallpaper': {
        if (action.isSame || !action.wallpaper?.document || action.wallpaper.isPattern) return undefined;
        return (
          <div className={styles.contentBox}>
            <WallpaperPreview
              wallpaper={action.wallpaper}
              observeIntersection={observeIntersectionForLoading}
            />
            <div className={styles.suggestedText}>
              <ActionMessageText message={message} />
            </div>
          </div>
        );
      }

      case 'chatEditPhoto': {
        if (!action.photo) return undefined;
        return (
          <ChannelPhoto
            action={action}
            observeIntersection={observeIntersectionForLoading}
            onClick={handleClick}
          />
        );
      }

      case 'suggestProfilePhoto':
        return (
          <SuggestedPhoto
            message={message}
            action={action}
            observeIntersection={observeIntersectionForLoading}
          />
        );

      case 'suggestBirthday':
        return (
          <SuggestedBirthday
            message={message}
            action={action}
          />
        );

      case 'noForwardsRequest':
        return (
          <NoForwardsRequest
            message={message}
          />
        );

      default:
        return undefined;
    }
  }, [
    action, message, observeIntersectionForLoading,
  ]);

  return (
    <div
      ref={refWithTransition}
      id={getMessageHtmlId(id)}
      className={buildClassName(
        'ActionMessage',
        'message-list-item',
        styles.root,
        isSingleLine && styles.singleLine,
        withLinkBreaks && styles.withLinkBreaks,
        isFluidMultiline && styles.fluidMultiline,
        fullContent && styles.hasFullContent,
        isFocused && !noFocusHighlight && 'focused',
        isContextMenuShown && 'has-menu-open',
        isLastInList && 'last-in-list',
      )}
      data-message-id={message.id}
      data-is-pinned={message.isPinned || undefined}
      data-has-unread-mention={message.hasUnreadMention || undefined}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      {!isTextHidden && (
        <>
          {isFluidMultiline && (
            <div className={styles.inlineWrapper}>
              <span className={styles.fluidBackground} style={fluidBackgroundStyle}>
                <ActionMessageText message={message} />
              </span>
            </div>
          )}
          <div className={styles.inlineWrapper}>
            <span
              className={styles.textContent}
              role="button"
              tabIndex={0}
              onClick={handleClick}
              onKeyDown={handleKeyDown}
            >
              <ActionMessageText message={message} />
            </span>
          </div>
        </>
      )}
      {(fullContent || shouldRenderNoForwardsButtons) && (
        <div className={styles.contentWrapper}>
          {fullContent}
          {shouldRenderNoForwardsButtons && (
            <InlineButtons
              className={styles.inlineButtons}
              inlineButtons={noForwardsInlineButtons}
              onClick={handleInlineButtonClick}
            />
          )}
        </div>
      )}
      {contextMenuAnchor && (
        <ContextMenuContainer
          isOpen={isContextMenuOpen}
          anchor={contextMenuAnchor}
          message={message}
          messageListType="thread"
          threadId={threadId}
          className={styles.contextContainer}
          onClose={handleContextMenuClose}
          onCloseAnimationEnd={handleContextMenuHide}
        />
      )}
      {withServiceReactions && (
        <Reactions
          isOutside
          message={message}
          threadId={threadId}
          observeIntersection={observeIntersectionForPlaying}
          isAccountFrozen={isAccountFrozen}
        />
      )}
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { message, threadId }): Complete<StateProps> => {
    const tabState = selectTabState(global);

    const sender = selectSender(global, message);

    const { replyToMsgId, replyToPeerId } = getMessageReplyInfo(message) || {};
    const replyMessage = replyToMsgId
      ? selectChatMessage(global, replyToPeerId || message.chatId, replyToMsgId) : undefined;

    const isFocused = threadId ? selectIsMessageFocused(global, message, threadId) : false;
    const {
      direction: focusDirection,
      noHighlight: noFocusHighlight,
      isResizingContainer, scrollTargetPosition,
    } = (isFocused && tabState.focusedMessage) || {};

    const isAccountFrozen = selectIsCurrentUserFrozen(global);

    return {
      actionMessageBg: selectActionMessageBg(global, message.chatId),
      sender,
      currentUserId: global.currentUserId,
      isFocused,
      focusDirection,
      noFocusHighlight,
      replyMessage,
      isInSelectMode: selectIsInSelectMode(global),
      isResizingContainer,
      scrollTargetPosition,
      isAccountFrozen,
      noForwardsRequestExpirePeriod: global.appConfig.noForwardsRequestExpirePeriod,
    };
  },
)(ActionMessage));
