import {Component, createSignal, For, onCleanup, onMount, Show} from 'solid-js';
import InputField from '@components/inputField';
import RadioFieldTsx from '@components/radioFieldTsx';
import Section from '@components/section';
import showRecoveryKeyPopup from '@components/popups/recoveryKey';
import createDownloadAnchor from '@helpers/dom/createDownloadAnchor';
import formatBytes from '@helpers/formatBytes';
import {LangPackKey} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {
  backUpNow,
  cancelBackup,
  disableBackups,
  enableBackups,
  exportBackupFile,
  fetchBackupRemoteStatus,
  fetchBackupSettings,
  importBackupFile,
  setBackupFrequency,
  SignalBackupFrequency,
  SignalBackupRemoteStatus,
  SignalBackupResult,
  SignalBackupSettings
} from '@lib/signal/settingsApi';

const FREQUENCIES: SignalBackupFrequency[] = ['daily', 'weekly', 'monthly', 'manual'];
const FREQUENCY_KEYS: Record<SignalBackupFrequency, LangPackKey> = {
  daily: 'BackupsFrequencyDaily',
  weekly: 'BackupsFrequencyWeekly',
  monthly: 'BackupsFrequencyMonthly',
  manual: 'BackupsFrequencyManual'
};
// * the reasons that an action fails (`BackupErrorReason` of the provider), as Web A's `BACKUP_ERROR_KEYS`
const ACTION_ERROR_KEYS: Record<string, LangPackKey> = {
  unavailable: 'BackupsUnavailable',
  rateLimited: 'BackupsErrorRateLimited',
  network: 'BackupsErrorNetwork',
  notEnabledOnPrimary: 'BackupsErrorNotEnabled',
  invalidBackup: 'BackupsErrorInvalidBackup',
  wrongKey: 'BackupsErrorWrongKey',
  invalidKey: 'BackupsErrorInvalidKey',
  forwardSecrecyLost: 'BackupsErrorForwardSecrecy',
  rejected: 'BackupsErrorRejected',
  existingBackup: 'BackupsErrorExistingBackup',
  failed: 'ErrorUnexpected'
};
// * the reasons that the last backup failed (`BackupService.noteFailure`), as Web A's `ERROR_KEYS`
const LAST_ERROR_KEYS: Record<string, LangPackKey> = {
  rateLimited: 'BackupsErrorRateLimited',
  server: 'BackupsErrorNetwork',
  unexpected: 'BackupsErrorNetwork',
  tooLarge: 'BackupsErrorNetwork',
  svrb: 'BackupsErrorNetwork',
  unauthorized: 'BackupsErrorRejected',
  verificationFailed: 'BackupsErrorRejected',
  notFound: 'BackupsErrorNotEnabled',
  validation: 'BackupsErrorInvalidBackup'
};
// * the level of the free tier of Signal Secure Backups (zkgroup `BackupLevel::Free`)
const FREE_TIER = 200;
const PERCENT = 100;

/**
 * TeleSignal: Signal Secure Backups of the account, as Web A's `SettingsBackups`: the state of the last backup and the
 * one on Signal's servers, turning backups on and off, their frequency, the recovery key, and a backup file to save
 * or to restore from. A linked device shows the state and works with files only.
 */
const Backups: Component = () => {
  const {Row, i18n, confirmationPopup, toastNew} = useHotReloadGuard();

  const [settings, setSettings] = createSignal<SignalBackupSettings>();
  const [remote, setRemote] = createSignal<SignalBackupRemoteStatus>();
  const [isUpdating, setIsUpdating] = createSignal(false);

  const onSettings = (value: SignalBackupSettings) => setSettings(value);
  rootScope.addEventListener('signal_backup_settings', onSettings);
  onCleanup(() => rootScope.removeEventListener('signal_backup_settings', onSettings));

  onMount(async() => {
    const [value, remoteValue] = await Promise.all([fetchBackupSettings(), fetchBackupRemoteStatus()]);
    setSettings(value);
    setRemote(remoteValue);
  });

  /** Runs an action: the settings after it, or the reason that it failed as a toast */
  const run = async(action: () => Promise<SignalBackupResult>) => {
    setIsUpdating(true);
    const result = await action().catch((): SignalBackupResult => ({error: 'failed'}));
    setIsUpdating(false);
    if(!result) return;
    if('error' in result) {
      toastNew({langPackKey: ACTION_ERROR_KEYS[result.error] || 'ErrorUnexpected'});
      return;
    }

    setSettings(result);
    setRemote(await fetchBackupRemoteStatus());
  };

  const turnOn = (shouldReplaceBackup?: boolean) => run(() => enableBackups(settings()?.frequency || 'daily', shouldReplaceBackup));

  // * the first backup replaces the one on the service, so the user confirms that first
  const onTurnOn = async() => {
    setIsUpdating(true);
    const remoteValue = await fetchBackupRemoteStatus();
    setIsUpdating(false);
    setRemote(remoteValue);
    if(!remoteValue?.hasBackup) {
      turnOn();
      return;
    }

    confirmationPopup({
      titleLangKey: 'BackupsTurnOn',
      descriptionLangKey: 'BackupsReplaceText',
      button: {langKey: 'BackupsReplaceConfirm', isDanger: true}
    }).then(() => turnOn(true), () => {});
  };

  const onTurnOff = () => {
    confirmationPopup({
      titleLangKey: 'BackupsTurnOff',
      descriptionLangKey: 'BackupsTurnOffText',
      button: {langKey: 'BackupsTurnOffDelete', isDanger: true}
    }).then(() => run(() => disableBackups(true)), () => {});
  };

  const onExport = async() => {
    setIsUpdating(true);
    const result = await exportBackupFile().catch((): {error: string} => ({error: 'failed'}));
    setIsUpdating(false);
    if(!result) return;
    if('error' in result) {
      toastNew({langPackKey: ACTION_ERROR_KEYS[result.error] || 'ErrorUnexpected'});
      return;
    }

    const url = URL.createObjectURL(new Blob([result.data as BlobPart], {type: 'application/octet-stream'}));
    createDownloadAnchor(url, result.fileName, () => URL.revokeObjectURL(url));
  };

  // * the recovery key first, then the file: choosing the file follows the click on the popup's button, which lets the
  // * browser open the picker
  const onImport = () => {
    const keyField = new InputField({label: 'BackupsRecoveryKey', plainText: true, required: true, withLinebreaks: false});
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.backup,application/octet-stream';
    fileInput.addEventListener('change', async() => {
      const file = fileInput.files?.[0];
      if(!file) return;
      setIsUpdating(true);
      const result = await importBackupFile(new Uint8Array(await file.arrayBuffer()), keyField.value.trim())
      .catch((): {error: string} => ({error: 'failed'}));
      setIsUpdating(false);
      if(!result) return;
      if('error' in result) {
        toastNew({langPackKey: ACTION_ERROR_KEYS[result.error] || 'ErrorUnexpected'});
        return;
      }

      toastNew({langPackKey: 'BackupsImportDone', langPackArguments: [result.messageCount]});
    });

    confirmationPopup({
      titleLangKey: 'BackupsImportFile',
      descriptionLangKey: 'BackupsImportText',
      content: <p class="popup-description">{i18n('BackupsImportMergeNote')}</p>,
      inputField: keyField,
      button: {
        langKey: 'BackupsImportChoose',
        callback: () => {
          fileInput.click();
        }
      }
    }).catch(() => {});
  };

  const lastBackup = () => {
    const {lastBackupAt, lastBackupSize} = settings();
    if(!lastBackupAt) return i18n('BackupsNever');
    const date = new Date(lastBackupAt).toLocaleString();
    return lastBackupSize ? `${date}, ${formatBytes(lastBackupSize)}` : date;
  };

  const progressText = () => {
    const progress = settings().progress;
    if(!progress || progress.step === 'exporting') return i18n('BackupsStepExporting');
    if(progress.step === 'validating') return i18n('BackupsStepValidating');
    return i18n('BackupsStepUploading', [`${Math.floor((progress.progress ?? 0) * PERCENT)}%`]);
  };

  const remoteText = () => {
    const value = remote();
    if(!value.hasBackup || value.size === undefined) return i18n('BackupsOnServerNone');
    const size = formatBytes(value.size);
    return value.modifiedAt ? `${new Date(value.modifiedAt).toLocaleString()}, ${size}` : size;
  };

  const Status = () => (
    <Section>
      <Row>
        <Row.Icon icon="recent" />
        <Row.Title>{i18n('BackupsLastBackup')}</Row.Title>
        <Row.Subtitle>{settings().isRunning ? progressText() : lastBackup()}</Row.Subtitle>
      </Row>
      <Show when={remote()}>
        <Row>
          <Row.Icon icon="cloud" />
          <Row.Title>{i18n('BackupsOnServer')}</Row.Title>
          <Row.Subtitle>{remoteText()}</Row.Subtitle>
        </Row>
      </Show>
      <Show when={settings().lastError && !settings().isRunning}>
        <Row>
          <Row.Icon icon="info" />
          <Row.Title>{i18n('BackupsLastFailed')}</Row.Title>
          <Row.Subtitle>{i18n(LAST_ERROR_KEYS[settings().lastError] || 'ErrorUnexpected')}</Row.Subtitle>
        </Row>
      </Show>
      <Show when={settings().isPrimary}>
        <Show
          when={settings().isRunning}
          fallback={
            <Row clickable={isUpdating() ? undefined : () => run(backUpNow)}>
              <Row.Icon icon="rotate_right" />
              <Row.Title>{i18n('BackupsBackUpNow')}</Row.Title>
            </Row>
          }
        >
          <Row color="danger" clickable={() => cancelBackup()}>
            <Row.Icon icon="close" />
            <Row.Title class="danger">{i18n('BackupsCancel')}</Row.Title>
          </Row>
        </Show>
      </Show>
    </Section>
  );

  const Enabled = () => (
    <>
      <Status />
      <Section
        name="BackupsFrequency"
        caption={settings().tier !== undefined && settings().tier !== FREE_TIER ? 'BackupsTierPaid' : 'BackupsTierFree'}
      >
        <For each={FREQUENCIES}>
          {(frequency) => (
            <Row>
              <Row.RadioField>
                <RadioFieldTsx
                  checked={settings().frequency === frequency}
                  name="backup-frequency"
                  value={frequency}
                  onChange={(checked) => checked && run(() => setBackupFrequency(frequency))}
                />
              </Row.RadioField>
              <Row.Title>{i18n(FREQUENCY_KEYS[frequency])}</Row.Title>
            </Row>
          )}
        </For>
      </Section>
      <Section caption="BackupsRecoveryKeyAbout">
        <Row clickable={() => showRecoveryKeyPopup()}>
          <Row.Icon icon="key" />
          <Row.Title>{i18n('BackupsRecoveryKey')}</Row.Title>
        </Row>
        <Row color="danger" clickable={isUpdating() || settings().isRunning ? undefined : onTurnOff}>
          <Row.Icon icon="delete" />
          <Row.Title class="danger">{i18n('BackupsTurnOff')}</Row.Title>
        </Row>
      </Section>
    </>
  );

  return (
    <Show when={settings()}>
      <Show
        when={!settings().unavailableReason}
        fallback={
          <Section caption={settings().unavailableReason === 'noRecoveryKey' ?
            'BackupsUnavailableNoRecoveryKey' :
            'BackupsUnavailableNoMediaKey'}
          noContent
          />
        }
      >
        <Show when={settings().isPrimary} fallback={<><Section caption="BackupsLinkedDevice" noContent /><Status /></>}>
          <Show
            when={settings().isEnabled}
            fallback={
              <Section caption="BackupsTierFree">
                <p class="section-caption">{i18n('BackupsAbout')}</p>
                <Row clickable={isUpdating() ? undefined : onTurnOn}>
                  <Row.Icon icon="archive" />
                  <Row.Title>{i18n('BackupsTurnOn')}</Row.Title>
                </Row>
              </Section>
            }
          >
            <Enabled />
          </Show>
        </Show>
        <Section name="BackupsFile" caption="BackupsFileAbout">
          <Row clickable={isUpdating() || settings().isRunning ? undefined : onExport}>
            <Row.Icon icon="download" />
            <Row.Title>{i18n('BackupsExportFile')}</Row.Title>
          </Row>
          <Row clickable={isUpdating() || settings().isRunning ? undefined : onImport}>
            <Row.Icon icon="upload" />
            <Row.Title>{i18n('BackupsImportFile')}</Row.Title>
          </Row>
        </Section>
      </Show>
    </Show>
  );
};

export default Backups;
