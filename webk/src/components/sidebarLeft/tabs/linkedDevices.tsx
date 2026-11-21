import {Component, createSignal, For, onMount, Show} from 'solid-js';
import InputField from '@components/inputField';
import Section from '@components/section';
import {formatDateAccordingToTodayNew} from '@helpers/date';
import {LangPackKey} from '@lib/langPack';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {
  fetchLinkedDevices,
  linkDevice,
  SignalDevice,
  SignalDevices,
  unlinkDevice
} from '@lib/signal/settingsApi';

// * the primary device is the first one of an account (`SIGNAL_PRIMARY_DEVICE_ID`)
const PRIMARY_DEVICE_ID = 1;

const LINK_ERROR_KEYS: Record<string, LangPackKey> = {
  badCode: 'Signal.Devices.LinkBadCode',
  limit: 'Signal.Devices.LinkLimit',
  rejected: 'Signal.Devices.LinkRejected',
  rateLimited: 'Signal.Devices.LinkRateLimited',
  noKey: 'Signal.Devices.LinkNoKey'
};

const LinkedDevices: Component = () => {
  const {Row, i18n, confirmationPopup, toastNew} = useHotReloadGuard();

  const [devices, setDevices] = createSignal<SignalDevices>();
  const [isLoaded, setIsLoaded] = createSignal(false);

  const refresh = async() => {
    setDevices(await fetchLinkedDevices());
    setIsLoaded(true);
  };

  onMount(() => {
    refresh();
  });

  const getDeviceName = (device: SignalDevice) => device.name || i18n('Signal.Devices.Unnamed');

  const onLinkClick = () => {
    const inputField = new InputField({
      label: 'Signal.Devices.LinkField',
      plainText: true,
      required: true,
      withLinebreaks: false
    });

    confirmationPopup({
      titleLangKey: 'Signal.Devices.LinkTitle',
      descriptionLangKey: 'Signal.Devices.LinkText',
      inputField,
      button: {
        langKey: 'Signal.Devices.LinkConfirm',
        callback: async() => {
          // * a failed attempt keeps the popup open with the link in the field, as the field's own check does
          const result = await linkDevice(inputField.value.trim());
          if(!result) {
            toastNew({langPackKey: 'Signal.Devices.LinkNetwork'});
            return false;
          }

          if(result.error) {
            toastNew({langPackKey: LINK_ERROR_KEYS[result.error] || 'Signal.Devices.LinkNetwork'});
            return false;
          }

          toastNew({langPackKey: result.isPending ? 'Signal.Devices.LinkPending' : 'Signal.Devices.Linked'});
          refresh();
        }
      }
    }).catch(() => {});
  };

  const onUnlinkClick = (device: SignalDevice) => {
    confirmationPopup({
      titleLangKey: 'Signal.Devices.UnlinkTitle',
      titleLangArgs: [getDeviceName(device)],
      descriptionLangKey: 'Signal.Devices.UnlinkText',
      button: {
        langKey: 'Signal.Devices.Unlink',
        isDanger: true,
        callback: async() => {
          const unlinked = await unlinkDevice(device.id);
          if(!unlinked) {
            toastNew({langPackKey: 'Signal.Devices.UnlinkFailed'});
            return false;
          }

          refresh();
        }
      }
    }).catch(() => {});
  };

  const DeviceRow = (props: {device: SignalDevice}) => {
    const isCurrent = () => props.device.id === devices()!.currentDeviceId;
    const canUnlink = () => devices()!.isPrimary && !isCurrent();

    return (
      <Row
        clickable={canUnlink() ? () => onUnlinkClick(props.device) : undefined}
      >
        <Row.Icon icon={props.device.id === PRIMARY_DEVICE_ID ? 'phone_filled' : 'devices_filled'} />
        <Row.Title>{getDeviceName(props.device)}</Row.Title>
        <Row.Subtitle>
          {isCurrent() ?
            i18n('Signal.Devices.ThisDevice') :
            i18n('Signal.Devices.LastActive', [formatDateAccordingToTodayNew(new Date(props.device.lastSeen))])}
        </Row.Subtitle>
      </Row>
    );
  };

  return (
    <div class="linked-devices">
      <Show when={devices()}>
        {(list) => (
          <>
            <Show when={list().isPrimary}>
              <Section>
                <Row clickable={onLinkClick}>
                  <Row.Icon icon="add" />
                  <Row.Title>{i18n('Signal.Devices.Link')}</Row.Title>
                </Row>
              </Section>
            </Show>
            <Section caption={list().isPrimary ? 'Signal.Devices.PrimaryAbout' : 'Signal.Devices.LinkedAbout'}>
              <For each={list().devices}>
                {(device) => <DeviceRow device={device} />}
              </For>
            </Section>
          </>
        )}
      </Show>
      <Show when={isLoaded() && !devices()}>
        <div class="linked-devices-empty">{i18n('Signal.Devices.LoadFailed')}</div>
      </Show>
    </div>
  );
};

export default LinkedDevices;
