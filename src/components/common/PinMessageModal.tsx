import { memo } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import { isChatBasicGroup } from '../../global/helpers';
import { selectChat } from '../../global/selectors';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Modal from '../ui/Modal';

export type OwnProps = {
  isOpen: boolean;
  chatId: string;
  messageId: number;
  onClose: () => void;
};

type StateProps = {
  isGroup: boolean;
};

// A Signal pin is always for everyone in the chat, so the dialog has no choice to pin for ourselves alone
const PinMessageModal = ({
  isOpen,
  chatId,
  messageId,
  isGroup,
  onClose,
}: OwnProps & StateProps) => {
  const { pinMessage } = getActions();

  const lang = useLang();

  const handlePinMessage = useLastCallback(() => {
    pinMessage({ chatId, messageId, isUnpin: false });
    onClose();
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="pin"
      title={lang('PinMessageAlertTitle')}
    >
      <p>{lang(isGroup ? 'PinMessageAlert' : 'PinMessageAlertChat')}</p>
      <div className="dialog-buttons">
        <Button className="confirm-dialog-button" isText onClick={handlePinMessage}>
          {lang('DialogPin')}
        </Button>
        <Button className="confirm-dialog-button" isText onClick={onClose}>{lang('Cancel')}</Button>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);

    return {
      isGroup: Boolean(chat) && isChatBasicGroup(chat),
    };
  },
)(PinMessageModal));
