import type {Message} from '@layer';
import type {AdminLog} from '@appManagers/appChatsManager';
import type Chat from '@components/chat/chat';
import forEachReverse from '@helpers/array/forEachReverse';
import getPeerId from '@appManagers/utils/peers/getPeerId';
import type {BubbleElementAddons} from '@components/chat/types';
import ChatThreadSeparator from '@components/chat/bubbleParts/chatThreadSeparator';
import SolidJSHotReloadGuardProvider from '@lib/solidjs/hotReloadGuardProvider';

type SeparatorItem = {
  bubble: HTMLElement,
  message: Message.message | Message.messageService | AdminLog
};

type SeparatorChat = Pick<Chat,
  'hashtagType' |
  'isOutMessage' |
  'bubbles'
>;

function removeSeparator(item: SeparatorItem) {
  item.bubble.classList.remove('has-chat-thread-separator');
  (item.bubble as BubbleElementAddons).chatThreadSeparator?.remove();
}

export default function updateChatThreadSeparators(items: SeparatorItem[], chat: SeparatorChat) {
  // * only the search of my messages in every chat tells their chats apart
  if(chat.hashtagType !== 'my') {
    items.forEach(removeSeparator);
    return;
  }

  let prevKey: number | string;

  forEachReverse(items, (item, i) => {
    const message = item.message;
    if(message._ !== 'message' || !chat.isOutMessage(message)) {
      removeSeparator(item);
      return;
    }

    const peerId = message.peerId;
    const threadId: number = message.saved_peer_id && getPeerId(message.saved_peer_id);
    const targetPeerId = peerId;
    const targetThreadId = threadId;
    const key = `${peerId}_${threadId || ''}`;

    const bubbleAddons = item.bubble as BubbleElementAddons;

    if(prevKey === key) {
      removeSeparator(item);
      return;
    }

    prevKey = key;

    if(bubbleAddons.chatThreadSeparator) {
      bubbleAddons.chatThreadSeparator.feedProps<false>({
        peerId,
        threadId,
        targetPeerId,
        targetThreadId,
        index: -i
      });
      item.bubble.classList.add('has-chat-thread-separator');
      if(bubbleAddons.chatThreadSeparator.parentElement !== item.bubble) {
        item.bubble.prepend(bubbleAddons.chatThreadSeparator);
      }
      return;
    }

    bubbleAddons.chatThreadSeparator = new ChatThreadSeparator;
    bubbleAddons.chatThreadSeparator.HotReloadGuard = SolidJSHotReloadGuardProvider;
    bubbleAddons.chatThreadSeparator.feedProps({
      bubbles: chat.bubbles,
      peerId,
      threadId,
      targetPeerId,
      targetThreadId,
      index: -i
    });
    item.bubble.classList.add('has-chat-thread-separator');
    item.bubble.prepend(bubbleAddons.chatThreadSeparator);
  });
}
