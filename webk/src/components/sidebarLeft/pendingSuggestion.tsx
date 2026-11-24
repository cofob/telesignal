import Button from '@components/buttonTsx';
import CrossfadeBlock from '@components/crossfadeBlock';
import {PeerTitleTsx} from '@components/peerTitleTsx';
import RippleElement from '@components/rippleElement';
import createBirthdaySuggestions from '@components/sidebarLeft/birthdaySuggestions';
import createEmailSetupSuggestion from '@components/sidebarLeft/emailSetupSuggestion';
import createFrozenSuggestion from '@components/sidebarLeft/frozenSuggestion';
import createPasskeySetupSuggestion from '@components/sidebarLeft/passkeySetupSuggestion';
import type {PendingSuggestionController} from '@components/sidebarLeft/pendingSuggestionController';
import styles from '@components/sidebarLeft/pendingSuggestion.module.scss';
import collapsedPanelStyles from '@components/sidebarLeft/collapsedPanelButton.module.scss';
import selectPendingSuggestion, {PendingSuggestionType} from '@components/sidebarLeft/selectPendingSuggestion';
import {toastNew} from '@components/toast';
import documentFragmentToNodes from '@helpers/dom/documentFragmentToNodes';
import classNames from '@helpers/string/classNames';
import I18n, {i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import wrapEmojiText from '@lib/richTextProcessor/wrapEmojiText';
import {useIsSidebarCollapsed} from '@stores/foldersSidebar';
import {createEffect, createMemo, createSignal, Show} from 'solid-js';
import {render} from 'solid-js/web';

export function renderPendingSuggestion(toElement: HTMLElement) {
  render(() => {
    const birthdaySuggestions = createBirthdaySuggestions();
    const suggestions: Record<PendingSuggestionType, PendingSuggestionController> = {
      frozen: createFrozenSuggestion(),
      passkey: createPasskeySetupSuggestion(),
      birthdayContacts: birthdaySuggestions.contacts,
      birthdaySetup: birthdaySuggestions.setup
    };
    createEmailSetupSuggestion();

    const suggestionConstructor = createMemo(() => {
      const type = selectPendingSuggestion({
        frozen: suggestions.frozen.available(),
        passkey: suggestions.passkey.available(),
        birthdayContacts: suggestions.birthdayContacts.available(),
        birthdaySetup: suggestions.birthdaySetup.available()
      });

      return type ? suggestions[type].component : undefined;
    });

    createEffect(() => {
      document.body.classList.toggle('has-pending-suggestion', !!suggestionConstructor());
    });

    // * one suggestion taking another's place crossfades in it
    return (
      <CrossfadeBlock value={suggestionConstructor()} class={styles.suggestionContainer}>
        {(constructor) => constructor()}
      </CrossfadeBlock>
    );
  }, toElement);
}
