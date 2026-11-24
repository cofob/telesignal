import {Document, Message, MessageMedia} from '@layer';
import {getIsSignalAlbum} from '@lib/signal/media';

export function canSaveMessageMediaWithNoForwards(message: Message.message) {
  const document = (message.media as MessageMedia.messageMediaDocument)?.document;
  if(!document) {
    return false;
  }

  return !(['video', 'gif', 'round', 'sticker'] as Document.document['type'][]).includes((document as Document.document).type);
}

export default function canSaveMessageMedia(
  message: Message.message | Message.messageService,
  noForwards?: boolean
) {
  const media = (message as Message.message)?.media;
  // * a Signal album is paid media without a price (`@lib/signal/media`), which saves as any media does
  const isSignalAlbum = media?._ === 'messageMediaPaidMedia' && getIsSignalAlbum(media);
  return message &&
    !message.pFlags.is_outgoing &&
    !((media as MessageMedia.messageMediaInvoice)?.extended_media && !isSignalAlbum) &&
    (!((message as Message.message).pFlags.noforwards || noForwards) || canSaveMessageMediaWithNoForwards(message as Message.message));
}
