import type {AnyDialog} from '@lib/storages/dialogs';
import type {Dialog, SavedDialog} from '@appManagers/appMessagesManager';

export function isSavedDialog(dialog: AnyDialog): dialog is SavedDialog {
  return dialog?._ === 'savedDialog';
}

export function isDialog(dialog: AnyDialog): dialog is Dialog {
  return dialog?._ === 'dialog';
}
