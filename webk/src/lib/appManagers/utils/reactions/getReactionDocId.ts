import type {Reaction} from '@layer';

/**
 * The custom emoji a reaction is drawn as: a custom one's document, a standard one's select
 * animation — which `getStandardDocId` finds in the caller's catalog (a miss is the caller's to handle)
 */
export default function getReactionDocId(
  reaction: Reaction,
  getStandardDocId: (emoticon: string) => DocId | undefined
): DocId | undefined {
  switch(reaction._) {
    case 'reactionCustomEmoji': return reaction.document_id;
    case 'reactionEmoji': return getStandardDocId(reaction.emoticon);
  }
}
