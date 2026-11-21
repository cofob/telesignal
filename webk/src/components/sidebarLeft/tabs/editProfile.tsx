import {Component, createEffect, createMemo, createResource, createSignal, on, onMount, Show} from 'solid-js';
import ButtonIcon from '@components/buttonIcon';
import {AvatarNewTsx} from '@components/avatarNew';
import {InputFieldTsx} from '@components/inputFieldTsx';
import InputField from '@components/inputField';
import Section from '@components/section';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {type AppEditProfileTab} from '@components/solidJsTabs/tabs';
import showLinkQrCodePopup from '@components/popups/linkQrCode';
import {LangPackKey} from '@lib/langPack';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import rootScope from '@lib/rootScope';
import {toSignalPeerId} from '@lib/signal/builders';
import {
  callSignalApi,
  confirmUsername,
  deleteUsername,
  fetchUsernameLink,
  reserveUsername,
  resetUsernameLink,
  updateProfile
} from '@lib/signal/settingsApi';

// * Signal Android `ProfileName.MAX_PART_LENGTH` and the about limit of Signal Desktop's profile editor
const MAX_NAME_LENGTH = 26;
const MAX_ABOUT_LENGTH = 140;
// * `UsernameErrorKey` of the provider (`src/api/signal/methods/profile.ts`)
const USERNAME_ERROR_KEYS: Record<string, LangPackKey> = {
  taken: 'Signal.Username.Taken',
  reservationExpired: 'Signal.Username.Expired',
  rateLimited: 'Signal.Username.RateLimited',
  nicknameTooShort: 'Signal.Username.TooShort',
  nicknameTooLong: 'Signal.Username.TooLong',
  nicknameStartsWithDigit: 'Signal.Username.StartsWithDigit',
  nicknameCharacters: 'Signal.Username.Characters',
  discriminatorInvalid: 'Signal.Username.NumberInvalid'
};

type ProfileData = {
  firstName: string,
  lastName: string,
  about: string,
  hasPhoto: boolean,
  username?: string
};

const EditProfile: Component = () => {
  const [tab] = useSuperTab<typeof AppEditProfileTab>();
  const {Row, i18n, confirmationPopup, toastNew} = useHotReloadGuard();

  const selfPeerId = rootScope.myId;
  const [data] = createResource(() => loadProfile());

  const [username, setUsername] = createSignal<string>();
  const [usernameLink, setUsernameLink] = createSignal<string>();
  // * the profile as the engine stores it, which the fields are compared with
  const [saved, setSaved] = createSignal<ProfileData>();
  const [photo, setPhoto] = createSignal<File>();
  const [isPhotoRemoved, setIsPhotoRemoved] = createSignal(false);
  const [firstName, setFirstName] = createSignal('');
  const [lastName, setLastName] = createSignal('');
  const [about, setAbout] = createSignal('');

  async function loadProfile(): Promise<ProfileData> {
    const result: {
      user: {firstName?: string, lastName?: string, avatarPhotoId?: string, usernames?: {username: string, isActive?: boolean}[]},
      fullInfo: {bio?: string}
    } = await callSignalApi('fetchFullUser', {id: toSignalPeerId(selfPeerId)});
    const profile: ProfileData = {
      firstName: result?.user.firstName || '',
      lastName: result?.user.lastName || '',
      about: result?.fullInfo.bio || '',
      hasPhoto: !!result?.user.avatarPhotoId,
      username: result?.user.usernames?.find(({isActive}) => isActive)?.username
    };
    setSaved(profile);
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setAbout(profile.about);
    setUsername(profile.username);
    refreshUsernameLink();
    return profile;
  }

  const refreshUsernameLink = () => {
    fetchUsernameLink().then(setUsernameLink, () => {});
  };

  const isChanged = createMemo(() => {
    const current = saved();
    if(!current) return false;
    return firstName().trim() !== current.firstName ||
      lastName().trim() !== current.lastName ||
      about().trim() !== current.about ||
      photo() !== undefined ||
      isPhotoRemoved();
  });

  const onSave = async() => {
    if(!isChanged() || !firstName().trim()) return;

    const result = await updateProfile({
      firstName: firstName().trim(),
      lastName: lastName().trim() || undefined,
      bio: about().trim() || undefined,
      photo: photo(),
      shouldRemovePhoto: isPhotoRemoved() || undefined
    });
    if(!result) {
      toastNew({langPackKey: 'Signal.Profile.SaveFailed'});
      return;
    }

    // * the saved profile is read back, which also updates the self user the app shows
    setPhoto(undefined);
    setIsPhotoRemoved(false);
    await loadProfile();
    toastNew({langPackKey: 'Signal.Profile.Saved'});
  };

  const saveBtn = ButtonIcon('check', {ariaLabel: 'Save'});
  attachClickEvent(saveBtn, onSave, {listenerSetter: tab.listenerSetter});

  onMount(() => {
    tab.header.append(saveBtn);
  });

  // * the header's button shows only while there is something to save
  createEffect(on(isChanged, (changed) => saveBtn.classList.toggle('hide', !changed)));

  const onPhotoPick = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if(!file) return;
    setPhoto(file);
    setIsPhotoRemoved(false);
  };

  let photoInput: HTMLInputElement;

  const hasPhoto = () => (saved()?.hasPhoto && !isPhotoRemoved()) || photo() !== undefined;

  const onRemovePhotoClick = () => {
    setPhoto(undefined);
    setIsPhotoRemoved(true);
  };

  const onUsernameClick = () => {
    const usernameField = new InputField({
      label: 'Signal.Username.Nickname',
      plainText: true,
      required: true,
      withLinebreaks: false
    });

    confirmationPopup({
      titleLangKey: username() ? 'Signal.Username.Change' : 'Signal.Username.Set',
      descriptionLangKey: 'Signal.Username.Help',
      inputField: usernameField,
      button: {
        langKey: 'Save',
        callback: async() => {
          // * `nickname.12` picks the number, a bare nickname takes a free one
          const [nickname, discriminator] = usernameField.value.trim().split('.');
          const reserved = await reserveUsername(nickname, discriminator);
          if(!reserved?.username) {
            toastNew({langPackKey: USERNAME_ERROR_KEYS[reserved?.error] || 'Signal.Username.Failed'});
            return false;
          }

          const confirmed = await confirmUsername(reserved.username);
          if(!confirmed?.username) {
            toastNew({langPackKey: USERNAME_ERROR_KEYS[confirmed?.error] || 'Signal.Username.Failed'});
            return false;
          }

          setUsername(confirmed.username);
          refreshUsernameLink();
          toastNew({langPackKey: 'Signal.Username.Saved'});
        }
      }
    }).catch(() => {});
  };

  const onDeleteUsernameClick = () => {
    const current = username();
    confirmationPopup({
      titleLangKey: 'Signal.Username.Delete',
      descriptionLangKey: 'Signal.Username.DeleteConfirm',
      descriptionLangArgs: [current],
      button: {
        langKey: 'Delete',
        isDanger: true,
        callback: async() => {
          const deleted = await deleteUsername();
          if(!deleted) {
            toastNew({langPackKey: 'Signal.Username.Failed'});
            return false;
          }

          setUsername(undefined);
          setUsernameLink(undefined);
          toastNew({langPackKey: 'Signal.Username.Removed'});
        }
      }
    }).catch(() => {});
  };

  const onLinkClick = () => {
    const url = usernameLink();
    if(!url) return;
    showLinkQrCodePopup({url, aboutLangKey: 'Signal.Username.LinkAbout'});
  };

  const onResetLinkClick = () => {
    confirmationPopup({
      titleLangKey: 'Signal.Username.LinkReset',
      descriptionLangKey: 'Signal.Username.LinkResetConfirm',
      button: {
        langKey: 'Reset',
        isDanger: true,
        callback: async() => {
          const url = await resetUsernameLink();
          if(!url) {
            toastNew({langPackKey: 'Signal.Username.Failed'});
            return false;
          }

          setUsernameLink(url);
          toastNew({langPackKey: 'Signal.Username.LinkResetDone'});
        }
      }
    }).catch(() => {});
  };

  return (
    <Show when={data()}>
      <Section>
        <div class="edit-profile-photo">
          <AvatarNewTsx peerId={selfPeerId} size={120} />
        </div>
        <Row clickable={() => photoInput.click()}>
          <Row.Icon icon="camera" />
          <Row.Title>{i18n('Signal.Profile.SetPhoto')}</Row.Title>
        </Row>
        <Show when={hasPhoto()}>
          <Row clickable={onRemovePhotoClick}>
            <Row.Icon icon="delete" />
            <Row.Title>{i18n('Signal.Profile.RemovePhoto')}</Row.Title>
          </Row>
        </Show>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={onPhotoPick}
        />
      </Section>

      <Section caption="Signal.Profile.AboutHelp">
        <div class="input-wrapper">
          <InputFieldTsx
            label="FirstName"
            name="signal-first-name"
            maxLength={MAX_NAME_LENGTH}
            value={firstName()}
            onRawInput={setFirstName}
          />
          <InputFieldTsx
            label="LastName"
            name="signal-last-name"
            maxLength={MAX_NAME_LENGTH}
            value={lastName()}
            onRawInput={setLastName}
          />
          <InputFieldTsx
            label="Signal.Profile.About"
            name="signal-about"
            maxLength={MAX_ABOUT_LENGTH}
            withLinebreaks
            value={about()}
            onRawInput={setAbout}
          />
        </div>
      </Section>

      <Section caption="Signal.Profile.UsernameHelp">
        <Row clickable={onUsernameClick}>
          <Row.Icon icon="username" />
          <Row.Title>{username() ? '@' + username() : i18n('Signal.Username.Set')}</Row.Title>
          <Row.Subtitle>{i18n('Username')}</Row.Subtitle>
        </Row>
        <Show when={username()}>
          <Row clickable={usernameLink() ? onLinkClick : undefined}>
            <Row.Icon icon="link" />
            <Row.Title>{i18n('Signal.Username.Link')}</Row.Title>
            <Row.Subtitle>{i18n('Signal.Username.LinkAbout')}</Row.Subtitle>
          </Row>
          <Row clickable={onResetLinkClick}>
            <Row.Icon icon="replace" />
            <Row.Title>{i18n('Signal.Username.LinkReset')}</Row.Title>
          </Row>
          <Row color="danger" clickable={onDeleteUsernameClick}>
            <Row.Icon icon="delete" />
            <Row.Title class="danger">{i18n('Signal.Username.Delete')}</Row.Title>
          </Row>
        </Show>
      </Section>
    </Show>
  );
};

export default EditProfile;
