import {createSignal, For, onCleanup, onMount, Show} from 'solid-js';
import ButtonMenuToggle from '@components/buttonMenuToggle';
import lottieLoader from '@lib/lottie/lottieLoader';
import ButtonIcon from '@components/buttonIcon';
import rootScope from '@lib/rootScope';
import Row from '@components/rowTsx';
import {i18n, LangPackKey} from '@lib/langPack';
import {SliderSuperTabConstructable, SliderSuperTabEventable} from '@components/sliderTab';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import Section from '@components/section';
import {renderPeerProfile} from '@components/peerProfile';
import SolidJSHotReloadGuardProvider, {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import showMyQrCodePopup from '@components/popups/myQrCode';
import showLogOutPopup from '@components/popups/logOut';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {usePromiseCollector} from '@components/solidJsTabs/promiseCollector';
import InputSearch from '@components/inputSearch';
import Scrollable from '@components/scrollable2';
import InlinePortal from '@helpers/solid/inlinePortal';
import cancelEvent from '@helpers/dom/cancelEvent';
import SettingsSearchResults from '@components/sidebarLeft/settingsSearchResults';
import TransitionSlider from '@components/transition';
import appNavigationController, {NavigationItem} from '@components/appNavigationController';
import {SettingsSearchItem} from '@lib/settingsSearch';
import {openSettingsSearchItem} from '@lib/settingsSearch/navigate';
import {ROOT_SECTION_ID} from '@lib/settingsSearch/registry';
import {bumpRecentSettingsSearch} from '@lib/settingsSearch/recent';
import A11yButton from '@components/a11yButton';
import {getAppVersionText} from '@config/app';
import safeWindowOpen from '@helpers/dom/safeWindowOpen';
import {fetchLinkedDevices} from '@lib/signal/settingsApi';

// * Signal's help, which the settings point to instead of Telegram's FAQ
const SUPPORT_URL = 'https://support.signal.org/';
import {getKeptFlags} from '@config/modes';
import styles from '@components/sidebarLeft/tabs/settings.module.scss';


// ─────────────────────────────────────────────────────────────────────────────
// Helper — wraps a sub-tab declaration. If the tab has a static `getInitArgs`,
// fires the prefetch immediately so the per-domain promises (themes / filters /
// privacy bundle / etc.) start downloading the moment Settings opens.
// On click we await whatever was prefetched, hand it to `tab.open(...)`, and
// re-arm the prefetch after the sub-tab is destroyed.
// ─────────────────────────────────────────────────────────────────────────────

type SubTabConfig = {
  icon: Icon;
  text: LangPackKey;
  tabConstructor: SliderSuperTabConstructable;
  getInitArgs?: () => any[];
  args?: any;
};

const makeSubTabConfig = (
  icon: Icon,
  text: LangPackKey,
  tabConstructor: SliderSuperTabConstructable,
  fromTab: any
): SubTabConfig => {
  let getInitArgs: (() => any[]) | undefined;
  const g = (tabConstructor as any).getInitArgs;
  if(g) {
    getInitArgs = () => [g(fromTab)];
  }
  return {
    icon,
    text,
    tabConstructor,
    getInitArgs,
    args: getInitArgs?.()
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab UI
// ─────────────────────────────────────────────────────────────────────────────

const Settings = () => {
  const promiseCollector = usePromiseCollector();
  const [tab] = useSuperTab();

  // ── Header: search and the overflow menu, the way tdesktop keeps it — editing
  //    the profile and the QR code are rare enough to live in the menu.
  const searchBtn = ButtonIcon('search', {ariaLabel: 'Search'});
  const btnMenu = ButtonMenuToggle({
    listenerSetter: tab.listenerSetter,
    direction: 'bottom-left',
    buttonOptions: {ariaLabel: 'MultiAccount.More'},
    buttons: [{
      icon: 'edit',
      text: 'EditAccount.Title',
      // fresh args on every open, so a failed connected-bot request isn't retained
      onClick: () => tab.slider.createTab(hotReloadGuard.tabs.AppEditProfileTab).open()
    }, {
      icon: 'qr',
      text: 'QRCode.Title',
      onClick: () => showMyQrCodePopup()
    }, {
      icon: 'logout',
      text: 'EditAccount.Logout',
      danger: true,
      onClick: () => showLogOutPopup()
    }]
  });

  // ── Search over every setting (see @lib/settingsSearch). It is a second layer
  //    of the tab, cross-faded in over the settings the same way the left
  //    sidebar swaps the chat list for its search — except this one brings its
  //    own header, since it covers the tab's header too.
  const [searchQuery, setSearchQuery] = createSignal<string>(undefined);
  const isSearching = () => searchQuery() !== undefined;

  const mainLayer = document.createElement('div');
  mainLayer.classList.add('transition-item', 'settings-layer');

  const searchLayer = document.createElement('div');
  searchLayer.classList.add('transition-item', 'settings-layer', 'settings-search-layer');

  const searchBackBtn = ButtonIcon('left sidebar-close-button', {noRipple: true});

  const inputSearch = new InputSearch({
    placeholder: 'Search',
    // the same field the left sidebar's own search uses
    oldStyle: true,
    onChange: setSearchQuery,
    // The clear button empties the query; pressing it on an empty field leaves search.
    onClear: (e, wasEmpty) => wasEmpty && closeSearch(),
    alwaysShowClear: true
  });

  inputSearch.input.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') {
      cancelEvent(e);
      closeSearch();
    }
  });

  let selectLayer: ReturnType<typeof TransitionSlider>;

  // Search is a state to come back from, not a tab: Escape and the back gesture
  // leave it and keep the settings open, the way they do in the left sidebar.
  const NAVIGATION_TYPE: NavigationItem['type'] = 'settings-search';

  const openSearch = () => {
    if(isSearching()) {
      closeSearch();
      return;
    }

    setSearchQuery('');
    selectLayer(1);
    inputSearch.input.focus();

    if(!appNavigationController.findItemByType(NAVIGATION_TYPE)) {
      appNavigationController.pushItem({
        type: NAVIGATION_TYPE,
        onPop: () => void closeSearch(true)
      });
    }
  };

  const closeSearch = (fromNavigation?: boolean) => {
    if(!isSearching()) return;

    if(!fromNavigation) {
      appNavigationController.removeByType(NAVIGATION_TYPE);
    }

    setSearchQuery(undefined);
    selectLayer(0);
    inputSearch.value = '';
    // the field goes off screen, and typing into what cannot be seen is worse
    // than typing nowhere
    inputSearch.input.blur();
  };

  attachClickEvent(searchBackBtn, () => closeSearch(), {listenerSetter: tab.listenerSetter});

  // A section can take a request to open, and a second click while it is in
  // flight would open it twice — the list stays clickable, the navigation does not.
  let opening: Promise<void>;

  const onResultSelect = (item: SettingsSearchItem) => {
    if(opening) return;

    bumpRecentSettingsSearch(item.id);

    // A result that lives on this very screen opens no section of its own: the
    // search layer is the only thing between the user and it, so it steps aside.
    // Anything else keeps it — the layer stays behind the section that opens, so
    // going back returns to the results with the query still typed.
    if(item.sectionId === ROOT_SECTION_ID) {
      closeSearch();
    }

    opening = openSettingsSearchItem(item, tab)
    .catch((err) => console.error('settings search: cannot open', item.id, err))
    .finally(() => {
      opening = undefined;
    });
  };

  onMount(() => {
    tab.container.classList.add('settings-container', 'transition', 'zoom-fade');
    tab.header.append(searchBtn, btnMenu);

    // The tab's own header and content become the first layer, so the search can
    // fade in over both of them.
    mainLayer.append(tab.header, tab.content);
    tab.container.append(mainLayer, searchLayer);

    selectLayer = TransitionSlider({
      content: tab.container,
      type: 'zoom-fade',
      transitionTime: 150,
      listenerSetter: tab.listenerSetter
    });

    // Tell the slider which layer is showing — without it the first switch has
    // nothing to fade out of and both layers end up visible.
    selectLayer(0, false);
  });

  onCleanup(() => {
    appNavigationController.removeByType(NAVIGATION_TYPE);
    inputSearch.remove();
    // the header outlives the component (it belongs to the tab), so take the
    // buttons back out — otherwise a hot reload leaves a second set behind
    for(const button of [searchBtn, btnMenu]) button.remove();
    tab.container.append(tab.header, tab.content);
    mainLayer.remove();
    searchLayer.remove();
  });

  attachClickEvent(searchBtn, openSearch, {listenerSetter: tab.listenerSetter});

  // ── Sub-tab rows (notifications/data/privacy/general/folders/stickers).
  const subTabConfigs: SubTabConfig[] = [
    makeSubTabConfig('bell_filled', 'AccountSettings.Notifications', hotReloadGuard.tabs.AppNotificationsTab, tab),
    makeSubTabConfig('data_filled', 'DataSettings', hotReloadGuard.tabs.AppDataAndStorageTab, tab),
    makeSubTabConfig('key_filled', 'AccountSettings.PrivacyAndSecurity', hotReloadGuard.tabs.AppPrivacyAndSecurityTab, tab),
    makeSubTabConfig('general_filled', 'Telegram.GeneralSettingsViewController', hotReloadGuard.tabs.AppGeneralSettingsTab, tab),
    makeSubTabConfig('limit_folders_filled', 'AccountSettings.Filters', hotReloadGuard.tabs.AppChatFoldersTab, tab),
    makeSubTabConfig('reactions_filled', 'StickersName', hotReloadGuard.tabs.AppStickersAndEmojiTab, tab)
  ];

  const onSubTabClick = (item: SubTabConfig) => async() => {
    const args = item.args ? await item.args : [];
    const subTab = tab.slider.createTab(item.tabConstructor as any);
    subTab.open(...args);

    if(subTab instanceof SliderSuperTabEventable && item.getInitArgs) {
      (subTab as SliderSuperTabEventable).eventListener.addEventListener('destroyAfter', (promise) => {
        item.args = promise.then(() => item.getInitArgs() as any);
      });
    }
  };

  // ── Linked devices row: its count comes from the engine, the screen loads the list itself.
  const [deviceCount, setDeviceCount] = createSignal('');
  fetchLinkedDevices().then((devices) => {
    if(devices) setDeviceCount('' + devices.devices.length);
  }, () => {});

  const onDevicesClick = () => {
    tab.slider.createTab(hotReloadGuard.tabs.AppLinkedDevicesTab).open();
  };

  // ── Self profile (avatar + name + collapse-on-scroll). The avatar inside
  //    `PeerProfileAvatars` is filled async via `setPeer()` (peer photo IPC →
  //    appearance render → thumb load) — without waiting, the gradient header
  //    is rendered empty and the avatar pops in mid-transition. We collect the
  //    `onAvatarReady` promise so the tab opens with the avatar already in DOM.
  const peerProfileElement = renderPeerProfile({
    peerId: rootScope.myId,
    isDialog: false,
    scrollable: tab.scrollable,
    setCollapsedOn: mainLayer,
    onAvatarReady: (promise) => promiseCollector.collect(promise)
  }, SolidJSHotReloadGuardProvider);

  // Lottie workers preload — fire and forget.
  lottieLoader.loadLottieWorkers();

  // ── The version at the bottom opens Settings → Experimental, and says so while
  //    something there stays on for the whole site.
  const [experimentalOn, setExperimentalOn] = createSignal(getKeptFlags().size > 0);
  const openExperimental = () => {
    const experimentalTab = tab.slider.createTab(hotReloadGuard.tabs.AppExperimentalTab);
    experimentalTab.eventListener.addEventListener('close', () => {
      setExperimentalOn(getKeptFlags().size > 0);
    }, {once: true});
    experimentalTab.open(hotReloadGuard.tabs.getExperimentalInitArgs());
  };

  return (
    <>
      <InlinePortal mount={searchLayer}>
        <div class="sidebar-header">
          {searchBackBtn}
          {inputSearch.container}
        </div>
        <div class="sidebar-content">
          <Scrollable>
            <Show when={isSearching()}>
              <SettingsSearchResults query={searchQuery()} onSelect={onResultSelect} />
            </Show>
          </Scrollable>
        </div>
      </InlinePortal>
      {peerProfileElement}
      <Section>
        <div class="profile-buttons">
          <For each={subTabConfigs}>
            {(item) => (
              <Row clickable={onSubTabClick(item)}>
                <Row.Icon icon={item.icon} />
                <Row.Title>{i18n(item.text)}</Row.Title>
              </Row>
            )}
          </For>
          <Row clickable={onDevicesClick}>
            <Row.Icon icon="devices_filled" />
            <Row.Title titleRight={<span>{deviceCount()}</span>} titleRightSecondary>
              {i18n('Signal.Devices.Title')}
            </Row.Title>
          </Row>
          <Row clickable={() => tab.slider.createTab(hotReloadGuard.tabs.AppBackupsTab).open()}>
            <Row.Icon icon="archive" />
            <Row.Title>{i18n('SettingsBackups')}</Row.Title>
          </Row>
          <Row clickable={() => tab.slider.createTab(hotReloadGuard.tabs.AppKeyboardShortcutsTab).open()}>
            <Row.Icon icon="keyboard_filled" />
            <Row.Title>{i18n('KeyboardShortcuts.Title')}</Row.Title>
          </Row>
        </div>
      </Section>
      {/* help: Signal's support, which replaces Telegram's FAQ and its question to volunteers */}
      <Section>
        <Row clickable={() => safeWindowOpen(SUPPORT_URL)}>
          <Row.Icon icon="faq_filled" />
          <Row.Title>{i18n('MenuSignalSupport')}</Row.Title>
        </Row>
      </Section>
      <A11yButton class={styles.version} onClick={openExperimental}>
        <span dir="ltr">{getAppVersionText()}</span>
        <Show when={experimentalOn()}>
          <span class={styles.versionOn}>{i18n('Experimental.OnNotice')}</span>
        </Show>
      </A11yButton>
    </>
  );
};

export default Settings;
