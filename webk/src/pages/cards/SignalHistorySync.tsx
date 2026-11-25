import {onMount, Show} from 'solid-js';

import {putPreloader} from '@components/putPreloader';
import MediaHeader from '@components/mediaHeader';
import {i18n} from '@lib/langPack';
import type {SignalHistorySync} from '@lib/signal/registrationTypes';

import AuthCard from '@/pages/AuthCard';
import authStyles from '@/pages/authFlow.module.scss';
import styles from '@/pages/cards/SignalHistorySync.module.scss';

const PERCENT = 100;

/**
 * TeleSignal: the link screen while the primary device transfers the message history, after it scanned the code
 * (Web A's `AuthHistorySync`, after Signal Desktop's `InstallScreenBackupImportStep`)
 */
export default function SignalHistorySyncCard(props: {historySync: SignalHistorySync}) {
  let preloaderHost!: HTMLDivElement;

  const percent = () => `${Math.round((props.historySync.progress ?? 0) * PERCENT)}%`;

  onMount(() => {
    putPreloader(preloaderHost, true);
  });

  return (
    <AuthCard
      class={authStyles.pageSignQR}
      inputWrapper={false}
      header={
        <MediaHeader>
          <div class={styles.status}>
            <div ref={preloaderHost} class={styles.preloader} classList={{[styles.hidden]: props.historySync.step !== 'waiting'}} />
            <Show when={props.historySync.step !== 'waiting'}>
              <div class={styles.track}>
                <div class={styles.fill} style={{transform: `scaleX(${props.historySync.progress ?? 0})`}} />
              </div>
            </Show>
          </div>
          <MediaHeader.Title>{i18n('Signal.HistorySync.Title')}</MediaHeader.Title>
          <MediaHeader.Subtitle>
            {props.historySync.step === 'waiting' ?
              i18n('Signal.HistorySync.Waiting') :
              i18n(props.historySync.step === 'downloading' ? 'Signal.HistorySync.Downloading' : 'Signal.HistorySync.Importing', [percent()])}
          </MediaHeader.Subtitle>
          <MediaHeader.Subtitle color="secondary">{i18n('Signal.HistorySync.Note')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    />
  );
}
