/*
 * TeleSignal: picks the people of a Signal story distribution list among the contacts, for the stories settings
 * (`sidebarLeft/tabs/signalStories.tsx`). Kept apart from the tab: the settings search reads the tabs a settings tab
 * opens as its sections, and the picker opens only with a list to edit.
 */

import type SidebarSlider from '@components/slider';
import type {LangPackKey} from '@lib/langPack';
import {toPeerId, toSignalPeerId} from '@lib/signal/builders';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';

/** Opens the picker over `slider`; `onPicked` gets the provider ids of the people picked */
export default function pickSignalStoryPeople(
  slider: SidebarSlider,
  title: LangPackKey,
  memberIds: string[],
  onPicked: (memberIds: string[]) => void
) {
  slider.createTab(hotReloadGuard.tabs.AppAddMembersTab).open({
    type: 'privacy',
    skippable: true,
    title,
    placeholder: 'PrivacyModal.Search.Placeholder',
    peerType: ['contacts'],
    filterPeerTypeBy: ['isUser'],
    selectedPeerIds: memberIds.map(toPeerId),
    takeOut: (peerIds) => onPicked(peerIds.map((peerId) => toSignalPeerId(peerId)))
  });
}
