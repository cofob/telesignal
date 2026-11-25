/*
 * Types and manager-level helpers shared by the delete-messages popup and its moderation actions.
 * Kept apart so the actions can be tested without importing the popup's UI graph.
 */

import {Message, Reaction} from '@layer';
import {CheckboxFieldsField} from '@components/checkboxFields';

export type DeleteCheckboxFieldsField = CheckboxFieldsField & {
  peerId?: PeerId,
  action:
    'report' |
    'delete' |
    'deleteReactions' |
    'deleteOptions' |
    'ban',
  peerRow?: boolean
};

export type DeleteAction = Exclude<DeleteCheckboxFieldsField['action'], 'deleteOptions'>;

export type ModerateOptions = {
  reportSpam: boolean,
  reportReaction: boolean,
  deleteAllMessages: boolean,
  deleteAllReactions: boolean,
  banOrRestrict: boolean
};

export const getNoModerateOptions = (): ModerateOptions => ({
  reportSpam: false,
  reportReaction: false,
  deleteAllMessages: false,
  deleteAllReactions: false,
  banOrRestrict: false
});

export type ModerateMessage = Message.message | Message.messageService;

export type ModerateReactionEntry = {
  message: ModerateMessage,
  participantPeerId: PeerId,
  knownReaction?: Reaction
};
