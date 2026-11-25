import type {Chat, User} from '@layer';
import type {SignalBuiltChat} from '@lib/signal/builders';


export type ChatMembershipAction = 'join' | 'request' | 'leave';

export default function getChatMembershipAction(
  chat: Chat | User | undefined
): ChatMembershipAction | undefined {
  if(chat?._ !== 'chat' && chat?._ !== 'channel') {
    return;
  }

  if(!chat.pFlags.left) {
    return 'leave';
  }

  // * TeleSignal: a Signal group (a basic chat here) that we are not in (left, removed or ended) is joined only by
  // * its group link or an invite, as in Web A, which shows no Join button for it; one that invited us is joined by
  // * accepting the invitation (Web A's `FooterActionBar`)
  if(chat._ === 'chat') {
    return (chat as SignalBuiltChat).signal_not_joined ? 'join' : undefined;
  }

  return chat._ === 'channel' &&
    chat.pFlags.join_request &&
    !chat.pFlags.creator ?
    'request' :
    'join';
}
