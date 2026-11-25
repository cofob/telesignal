import type {AppManagers} from '@lib/managers';
import confirmationPopup, {
  PopupConfirmationOptions
} from '@components/confirmationPopup';
import {toastNew} from '@components/toast';

/** `plain`: the sender chose to remove the rich formatting (`richMessageToPlainMessage`). */
export type RichMessagePostingChoice = 'rich' | 'plain' | 'cancel';

type RichMessagePostingChoiceDependencies = {
  confirm: typeof confirmationPopup,
  showError: () => void
};

const DEFAULT_DEPENDENCIES: RichMessagePostingChoiceDependencies = {
  confirm: confirmationPopup,
  showError: () => toastNew({langPackKey: 'Error.AnError'})
};

export function createRichMessageUnavailableConfirmation(): PopupConfirmationOptions {
  return {
    titleLangKey: 'RichMessage.Unavailable.Title',
    descriptionLangKey: 'RichMessage.Unavailable.Text',
    footer: true,
    button: {langKey: 'RichMessage.RemoveFormatting'},
    cancelButton: {langKey: 'Cancel', isSecondary: true}
  };
}

export default async function getRichMessagePostingChoice(
  managers: AppManagers,
  dependencies = DEFAULT_DEPENDENCIES
): Promise<RichMessagePostingChoice> {
  let state: Awaited<ReturnType<AppManagers['appMessagesManager']['getRichMessagePostingState']>>;
  try {
    state = await managers.appMessagesManager.getRichMessagePostingState();
  } catch{
    dependencies.showError();
    return 'cancel';
  }
  if(state.allowed) return 'rich';

  try {
    // * TeleSignal: there is no Premium to offer, so a Premium-only posting is just unavailable
    await dependencies.confirm(createRichMessageUnavailableConfirmation());
    return 'plain';
  } catch{
    return 'cancel';
  }
}
