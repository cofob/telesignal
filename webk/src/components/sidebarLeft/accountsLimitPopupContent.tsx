import {MAX_ACCOUNTS_FREE} from '@lib/accounts/constants';
import {i18n_} from '@lib/langPack';

import Button from '@components/button';
import {IconTsx} from '@components/iconTsx';

export default function AccountsLimitPopupContent(props: {onClose: () => void}) {
  return (
    <div>
      <div class="accounts-limit__pin-container">
        <img class="accounts-limit__pin-image" src="assets/img/accounts-limit-pin-shape.svg" alt="" aria-hidden="true" />
        <IconTsx class="accounts-limit__pin-icon" icon="person_filled" />
        <span class="accounts-limit__pin-count">{MAX_ACCOUNTS_FREE}</span>
      </div>

      <div class="accounts-limit__description">{i18n_({key: 'MultiAccount.AccountsLimitDescription'})}</div>

      <div class="accounts-limit__actions">
        {(() => {
          const okButton = Button('popup-button btn primary', {text: 'OK'});
          okButton.addEventListener('click', props.onClose);
          return okButton;
        })()}
      </div>
    </div>
  );
}

