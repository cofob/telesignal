import {Message} from '@layer';
import getPeerId from '@appManagers/utils/peers/getPeerId';

/** The thread a message is in: its Saved Messages sublist, or the reply thread it answers */
export default function getMessageThreadId(message: Message.message | Message.messageService) {
  let threadId: number;
  const replyTo = message.reply_to;
  const savedPeerId = (message as Message.message).saved_peer_id && getPeerId((message as Message.message).saved_peer_id);
  if(savedPeerId) {
    threadId = savedPeerId;
  } else if(replyTo?._ === 'messageReplyHeader') {
    threadId = replyTo.reply_to_top_id || replyTo.reply_to_msg_id;
  }

  return threadId;
}
