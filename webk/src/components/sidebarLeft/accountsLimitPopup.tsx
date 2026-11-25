import PopupElement, {createPopup} from '@components/popups/indexTsx';
import AccountsLimitPopupContent from '@components/sidebarLeft/accountsLimitPopupContent';
import {createSignal} from 'solid-js';

export default function showAccountsLimitPopup() {
  const [show, setShow] = createSignal(true);

  createPopup(() => (
    <PopupElement class="accounts-limit-popup" closable>
      <PopupElement.Header>
        <PopupElement.Title title="LimitReached" />
      </PopupElement.Header>
      <PopupElement.Body>
        {AccountsLimitPopupContent({onClose: () => setShow(false)})}
      </PopupElement.Body>
    </PopupElement>
  ));
}
