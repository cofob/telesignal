import {JSX, createSignal} from 'solid-js';
import PopupElement, {createPopup} from '@components/popups/indexTsx';
import {LangPackKey, i18n} from '@lib/langPack';
import wrapPeerTitle from '@components/wrappers/peerTitle';
import wrapLocalSticker from '@components/wrappers/localSticker';
import liteMode from '@helpers/liteMode';
import {toastNew} from '@components/toast';
import toggleDisability from '@helpers/dom/toggleDisability';
import rootScope from '@lib/rootScope';
import {getMiddleware} from '@helpers/middleware';
import MediaHeader from '@components/mediaHeader';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import toastError from '@components/toastError';

export default async function showToggleReadDatePopup(peerId: PeerId, type: 'lastSeen' | 'readTime') {
  const managers = bindManagersToSession(rootScope.managers);
  const middlewareHelper = getMiddleware();

  const [title, stickerContainer] = await Promise.all([
    wrapPeerTitle({peerId, onlyFirstName: true}),
    wrapLocalSticker({
      width: 86,
      height: 86,
      assetName: type === 'lastSeen' ? 'large_lastseen' : 'large_readtime',
      middleware: middlewareHelper.get(),
      loop: false,
      autoplay: liteMode.isAvailable('stickers_chat')
    }).then(async({container, promise}) => {
      await promise;
      return container;
    })
  ]);

  const [show, setShow] = createSignal(true);

  const map: {[key in typeof type]: {
    title1: LangPackKey,
    lockedText: LangPackKey,
    buttonText1: LangPackKey,
    onClick: () => void
  }} = {
    lastSeen: {
      title1: 'PremiumLastSeenHeader1',
      lockedText: 'PremiumLastSeenText1Locked',
      buttonText1: 'PremiumLastSeenButton1',
      onClick: async() => {
        await managers.appPrivacyManager.setPrivacy(
          'inputPrivacyKeyStatusTimestamp',
          [{_: 'inputPrivacyValueAllowAll'}]
        );
        setShow(false);
        toastNew({langPackKey: 'PremiumLastSeenSet'});
      }
    },
    readTime: {
      title1: 'PremiumReadHeader1',
      lockedText: 'PremiumReadText1Locked',
      buttonText1: 'PremiumReadButton1',
      onClick: async() => {
        const globalPrivacy = await managers.appPrivacyManager.getGlobalPrivacySettings();
        await managers.appPrivacyManager.setGlobalPrivacySettings({
          _: 'globalPrivacySettings',
          pFlags: {
            ...globalPrivacy.pFlags,
            hide_read_marks: undefined
          }
        });
        setShow(false);
        toastNew({langPackKey: 'PremiumReadSet'});
      }
    }
  };

  const details = map[type];

  const Part = (props: {
    title: JSX.Element,
    text: JSX.Element,
    buttonText: LangPackKey,
    onClick: () => any
  }) => {
    let button: HTMLButtonElement;
    return (
      <>
        <MediaHeader>
          <MediaHeader.Title size={20}>{props.title}</MediaHeader.Title>
          <MediaHeader.Subtitle>{props.text}</MediaHeader.Subtitle>
        </MediaHeader>
        <button
          ref={button}
          class="btn-primary btn-color-primary popup-toggle-read-date-button"
          onClick={() => {
            const result = props.onClick();
            if(result instanceof Promise) {
              const toggle = toggleDisability(button, true);
              result.catch((err: ApiError) => {
                toggle();
                toastError(err, 'toggle read date error');
              });
            }
          }}
        >
          {i18n(props.buttonText)}
        </button>
      </>
    );
  };

  createPopup(() => (
    <PopupElement
      managers={managers}
      class="popup-toggle-read-date"
      closable
      show={show()}
      onCloseAfterTimeout={() => middlewareHelper.destroy()}
      old
    >
      <PopupElement.Header floating>
        <PopupElement.CloseButton />
      </PopupElement.Header>
      <PopupElement.Body>
        <MediaHeader.Sticker
          class="popup-toggle-read-date-sticker"
          size={86}
          element={stickerContainer}
        />
        <Part
          title={i18n(details.title1)}
          text={i18n(details.lockedText, [title])}
          buttonText={details.buttonText1}
          onClick={details.onClick}
        />
      </PopupElement.Body>
    </PopupElement>
  ));
}
