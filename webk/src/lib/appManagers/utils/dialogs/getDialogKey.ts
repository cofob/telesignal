import {AnyDialog} from '@lib/storages/dialogs';
import {isDialog, isSavedDialog} from '@appManagers/utils/dialogs/isDialog';

export default function getDialogKey(dialog: AnyDialog) {
  let key: number;
  if(isDialog(dialog)) {
    key = dialog.peerId;
  } else if(isSavedDialog(dialog)) {
    key = dialog.savedPeerId;
  }

  return key;
}
