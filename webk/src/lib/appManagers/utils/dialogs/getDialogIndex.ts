import type {Dialog, SavedDialog} from '@layer';
import type {REAL_FOLDER_ID} from '@appManagers/constants';
import getDialogIndexKey from '@appManagers/utils/dialogs/getDialogIndexKey';

export default function getDialogIndex(
  dialog: Dialog.dialog | SavedDialog.savedDialog,
  indexKey = getDialogIndexKey((dialog as Dialog.dialog)?.folder_id as REAL_FOLDER_ID)
) {
  return dialog?.[indexKey as 'index_0'];
}
