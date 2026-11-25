import confirmationPopup from '@components/confirmationPopup';
import InputField from '@components/inputField';
import {toastNew} from '@components/toast';
import noop from '@helpers/noop';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import rootScope from '@lib/rootScope';
import {toSignalPeerId} from '@lib/signal/builders';
import {confirmPhoneNumberLookup} from '@lib/signal/signalLinks';

type AddMemberByPhoneResult = {status: 'added' | 'invited'} | {error: 'notFound' | 'rateLimited' | 'unavailable'};

/**
 * Adds someone to a group by phone number, as Web A's `addChatMemberByPhoneNumber`: a number of a Signal user that we
 * know only by its PNI is invited. The number is looked up once the user agrees (`confirmPhoneNumberLookup`).
 */
export default async function showAddMemberByPhonePopup(chatId: ChatId) {
  const managers = bindManagersToSession(rootScope.managers);
  const phoneField = new InputField({label: 'Signal.AddByPhonePlaceholder', plainText: true, required: true});
  phoneField.input.setAttribute('inputmode', 'tel');

  try {
    await confirmationPopup({
      titleLangKey: 'Signal.AddByPhone',
      inputField: phoneField,
      button: {langKey: 'Add'}
    });
  } catch{
    return;
  }

  const phoneNumber = phoneField.value.replace(/\D/g, '');
  if(!phoneNumber || !await confirmPhoneNumberLookup(phoneNumber)) return;

  const result: AddMemberByPhoneResult | undefined = await managers.appSignalManager.callSignal(
    'addChatMemberByPhoneNumber',
    {chat: {id: toSignalPeerId(chatId.toPeerId(true))}, phoneNumber}
  ).catch(noop);
  const phone = '+' + phoneNumber;
  // * no result is a change that failed, which the provider reports itself
  if(!result) {
    return;
  } else if('error' in result) {
    toastNew(result.error === 'notFound' ?
      {langPackKey: 'SignalPhoneLookupNotFound', langPackArguments: [phone]} :
      {langPackKey: result.error === 'rateLimited' ? 'Signal.PhoneLookupRateLimited' : 'Signal.PhoneLookupUnavailable'});
  } else {
    toastNew({langPackKey: result.status === 'invited' ? 'Signal.GroupPhoneInvited' : 'Signal.GroupPhoneAdded', langPackArguments: [phone]});
    void managers.appProfileManager.getChatFull(chatId, true);
  }
}
