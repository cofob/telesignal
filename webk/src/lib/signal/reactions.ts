/*
 * TeleSignal: reactions of Signal messages in Web K's shapes. Signal keeps one reaction per person and takes any emoji,
 * so the picker lists Signal's preferred emoji (Signal Desktop `DEFAULT_PREFERRED_REACTION_EMOJI` in
 * `ts/axo/emoji.std.ts`, as Web A's picker does) and no catalog: Web K draws the emoji as text, where it draws the
 * stickers of Telegram's catalog otherwise.
 */

import type {Reaction} from '@layer';
import type {SignalReaction} from '@lib/signal/signalApi';

export const DEFAULT_REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '😮', '😢'];

export function buildReaction(reaction: SignalReaction): Reaction {
  return reaction.type === 'emoji' ?
    {_: 'reactionEmoji', emoticon: reaction.emoticon} :
    {_: 'reactionCustomEmoji', document_id: reaction.documentId};
}

/** Signal reactions are emoji; a reaction of any other kind cannot be sent */
export function toSignalReaction(reaction: Reaction): SignalReaction | undefined {
  return reaction._ === 'reactionEmoji' ? {type: 'emoji', emoticon: reaction.emoticon} : undefined;
}
