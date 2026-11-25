import AppSelectPeers, {SelectSearchPeerType} from '@components/appSelectPeers';
import PopupElement, {createPopup, PopupContext, PopupContextValue} from '@components/popups/indexTsx';
import I18n, {FormatterArguments, LangPackKey, i18n} from '@lib/langPack';
import {Modify} from '@types';
import {IsPeerType} from '@appManagers/appPeersManager';
import {Middleware} from '@helpers/middleware';
import deferredPromise from '@helpers/cancellablePromise';
import {MOUNT_CLASS_TO} from '@config/debug';
import Modes from '@config/modes';
import findUpAttribute from '@helpers/dom/findUpAttribute';
import cancelEvent from '@helpers/dom/cancelEvent';
import rootScope from '@lib/rootScope';
import createTopPeersList from '@components/topPeersList';
import findAndSplice from '@helpers/array/findAndSplice';
import FoldersTabs from '@components/foldersTabs';
import {observeResize} from '@components/resizeObserver';
import {render} from 'solid-js/web';
import {selectTarget} from '@components/horizontalMenu';
import {ScrollableContextValue} from '@components/scrollable2';
import whichChild from '@helpers/dom/whichChild';
import showLimitPopup from '@components/popups/limit';
import {Accessor, createSignal, JSX, Show, untrack, useContext} from 'solid-js';
import {ButtonIconTsx} from '@components/buttonIconTsx';
import fastSmoothScroll from '@helpers/fastSmoothScroll';
import {AppManagers} from '@lib/managers';
import {REAL_FOLDERS} from '@lib/appManagers/constants';

type PopupPickUserSelectedItem = {
  peerId: PeerId,
  key: string
};

export type PopupPickUserOptions = Modify<ConstructorParameters<typeof AppSelectPeers>[0], {
  appendTo?: never,
  managers?: never,
  onSelect?: (chosen: PopupPickUserSelectedItem[]) => Promise<void> | void,
  onClose?: () => void,
  onCloseAfterTimeout?: () => void,
  middleware?: never,
  titleLangKey: LangPackKey,
  titleLangArgs?: FormatterArguments,
  initial?: PeerId[],
  prependPeerIds?: PeerId[],
  footerButtonProps?: Parameters<typeof PopupElement['FooterButton']>[0],
  footer?: (ctx: {multiSelect: Accessor<AppSelectPeers['multiSelect']>}) => JSX.Element,
  autoHeight?: boolean,
  showTopPeers?: boolean,
  btnConfirmOnEnter?: Parameters<typeof PopupElement>[0]['btnConfirmOnEnter'],
  containerProps?: Parameters<typeof PopupElement>[0]['containerProps']
}>;

export default function showPickUserPopup(options: PopupPickUserOptions) {
  let multiSelect: AppSelectPeers['multiSelect'];
  if(typeof(options.multiSelect) === 'boolean') {
    multiSelect = options.multiSelect ? 'enabled' : 'disabled';
  } else {
    multiSelect = options.multiSelect;
  }
  multiSelect ||= 'disabled';

  const _onSelect = options.onSelect;

  const [show, setShow] = createSignal(false);
  const [multiSelectMode, setMultiSelectMode] = createSignal<AppSelectPeers['multiSelect']>(multiSelect);

  let selector: AppSelectPeers;
  let btnConfirm: HTMLButtonElement;
  const selected: Array<PopupPickUserSelectedItem> = [];

  let context: PopupContextValue;
  let managers: AppManagers;
  let middleware: Middleware;
  let night: boolean;

  const tabsContainer = document.createElement('div');
  tabsContainer.classList.add('tabs-container');

  let busy = false;
  const finalize = async() => {
    if(busy) {
      return;
    }

    busy = true;
    try {
      const res = _onSelect(selected);
      if(res instanceof Promise) {
        await res;
      }

      busy = false;
    } catch(err) {
      busy = false;
      throw err;
    }

    setShow(false);
  };

  const onSingleSelect = async(
    sel: AppSelectPeers,
    key: PeerId | string,
    adding: boolean
  ) => {
    key = '' + key;
    const item: PopupPickUserSelectedItem = {
      peerId: key.toPeerId(),
      key
    };

    if(adding) selected.push(item);
    else findAndSplice(selected, (item) => item.key === key);

    if((sel.multiSelect === 'enabled' && selected.length) || !selected.length) {
      return;
    }

    await finalize();
  };

  // The header button both reflects and drives the selector's mode, so the selector reports it back here
  const trackMultiSelectMode = (sel: AppSelectPeers) => {
    const originalSetMultiSelectMode = sel.setMultiSelectMode.bind(sel);
    sel.setMultiSelectMode = (mode) => {
      originalSetMultiSelectMode(mode);
      setMultiSelectMode(mode);
    };
    setMultiSelectMode(sel.multiSelect);
  };

  const enableMultiSelect = () => {
    selector?.setMultiSelectMode('enabled');
  };

  const createFolderTabs = (afterElement: HTMLElement) => {
    let menu: HTMLElement;
    let prevId = -1;
    const mount = document.createElement('div');
    mount.classList.add('popup-forward-folder-tabs-container', 'collapsable');
    afterElement.after(mount);
    let scrollableContext: ScrollableContextValue;

    const sectionContainer = selector.selectorSearch.section.container;
    const unobserve = observeResize(sectionContainer, () => {
      mount.style.top = sectionContainer.offsetHeight + 'px';
    });
    const lateMiddleware = untrack(() => context.lateMiddlewareHelper).get();
    lateMiddleware.onClean(unobserve);

    const deferred = deferredPromise<void>();

    const scrollToStart = (callback: () => void) => {
      let clicked = false;
      const onFinish = () => {
        if(!clicked) {
          clicked = true;
          callback();
        }
      };

      fastSmoothScroll({
        container: selector.scrollable.container,
        element: selector.section.container,
        position: 'start',
        getElementPosition: ({elementPosition}) => elementPosition -
          mount.offsetHeight -
          sectionContainer.offsetHeight,
        startCallback: ({duration, path}) => {
          if(path >= 0) onFinish();
          else setTimeout(onFinish, Math.max(0, duration / 2));
        }
      }).finally(callback);
    };

    const onTabClick = (target: HTMLElement, id: number) => {
      return selectTarget({
        target,
        id,
        tabs: menu,
        onClick: async() => {
          const filterId = +(target.dataset.filterId || 0);
          const available = REAL_FOLDERS.has(filterId) ||
            (await rootScope.managers.filtersStorage.isFilterIdAvailable(filterId) ?? true);
          if(!available) {
            showLimitPopup('folders');
            return false;
          }

          if(prevId !== -1) {
            await new Promise<void>((resolve) => scrollToStart(resolve));
          }

          selector.setFolderId(filterId);
          prevId = id;
        },
        prevId,
        scrollableX: scrollableContext
      });
    };

    const dispose = render(() => FoldersTabs({
      scrollableProps: {
        class: 'popup-forward-folder-tabs',
        scrollableProps: {
          contextRef: (ref) => scrollableContext = ref
        }
      },
      menuProps: {
        ref: (ref) => {
          menu = ref;
          queueMicrotask(async() => {
            const first = ref.firstElementChild as HTMLElement;
            if(first) await onTabClick(first, 0);
            deferred.resolve();
          });
        },
        onClick: (e) => {
          cancelEvent(e);
          const target = findUpAttribute(e.target, 'data-filter-id') as HTMLElement;
          if(!target) return;
          const id = whichChild(target);
          onTabClick(target, id);
        }
      },
      gradientProps: {
        color: 'background',
        className: 'popup-forward-folder-tabs-gradient'
      }
    }), mount);

    lateMiddleware.onClean(dispose);

    selector.onSearchChange = (query) => {
      mount.classList.toggle('is-collapsed', !!query);
    };

    return deferred;
  };

  function Inner() {
    context = useContext(PopupContext);
    managers = untrack(() => context.managers);
    middleware = untrack(() => context.middlewareHelper.get());
    night = untrack(() => context.night);

    selector = new AppSelectPeers({
      ...options,
      // * the picker's own `onSelect` is given the chosen rows, not the selector's single row
      onSelect: undefined,
      multiSelect,
      middleware,
      appendTo: tabsContainer,
      onChange: (length, changes) => {
        btnConfirm?.classList.toggle('is-visible', !!length);
        changes.forEach(({key, add}) => onSingleSelect(selector, key, add));
        options.onChange?.(length, changes);
      },
      onFirstRender: () => {
        setShow(true);
        selector.checkForTriggers();
      },
      noPlaceholder: true,
      rippleEnabled: false,
      avatarSize: 'abitbigger',
      managers,
      night,
      noInstantLoad: true,
      noSearch: options.noSearch
    });
    selector.container.classList.add('tabs-tab');

    trackMultiSelectMode(selector);

    const loadPromises: Promise<any>[] = [];
    if(options.showTopPeers) {
      const {group, promise} = createTopPeersList({
        middleware,
        className: 'popup-forward-top-peers collapsable',
        modifyPeers: (peers) => {
          findAndSplice(peers, (peer) => peer.id === rootScope.myId);
          // * Saved Messages leads the strip, unless the picker leaves it out as its list does
          if(!options.exceptSelf) {
            peers.unshift({
              id: rootScope.myId,
              rating: 0
            });
          }
          return peers;
        }
      });
      selector.heightContainer.before(group.container);

      loadPromises.push(createFolderTabs(group.container));

      const prevOnSearchChange = selector.onSearchChange;
      selector.onSearchChange = (query) => {
        group.container.classList.toggle('is-collapsed', !!query);
        prevOnSearchChange?.(query);
      };

      if(multiSelect !== 'disabled') promise.then(() => {
        const topPeerElements = group.list.querySelectorAll<HTMLElement>('.chatlist-chat');

        topPeerElements.forEach((el) => {
          const peerId = el.dataset.peerId.toPeerId();
          const sel = selector.selected.has(peerId);
          el.prepend(selector.checkbox(sel, 'white'));
        });
      });
    }

    if(options.initial) {
      selector.addInitial(options.initial);
    }
    selector.container.classList.add('active');

        Promise.all(loadPromises).then(() => {
      selector.loadFirst();
    });

    return tabsContainer;
  }

  function FooterInner(): JSX.Element {
    if(options.footer) {
      return options.footer({multiSelect: multiSelectMode});
    }

    return (
      <PopupElement.FooterButton
        confirm
        langKey={Modes.a11y ? 'Next' : undefined}
        callback={() => {
          finalize();
        }}
        {...(options.footerButtonProps || {})}
      />
    );
  }

  createPopup(() => {
    return (
      <PopupElement
        class="popup-forward selector-picker"
        containerClass={options.autoHeight ? 'popup-forward-auto-height' : undefined}
        containerProps={options.containerProps}
        closable
        show={show()}
        onClose={() => {
          options.onClose?.();
        }}
        onCloseAfterTimeout={() => {
          selector?.destroy();
          selector = undefined;
          options.onCloseAfterTimeout?.();
        }}
        btnConfirmOnEnter={options.btnConfirmOnEnter}
        initialFocus={() => selector?.inputSearch?.input}
      >
        <PopupElement.Header>
          <PopupElement.CloseButton />
          <PopupElement.Title title={options.titleLangArgs ? i18n(options.titleLangKey, options.titleLangArgs) : options.titleLangKey} />
          {/* 'hidden' is the only mode where multiselect is available but off — 'disabled' has none
              to offer and 'enabled' is already selecting, so the button belongs to that state alone */}
          <Show when={multiSelectMode() === 'hidden'}>
            <ButtonIconTsx
              icon="checkround"
              class="popup-forward-multiselect"
              aria-label={I18n.format('Message.Context.Select', true)}
              onClick={enableMultiSelect}
            />
          </Show>
        </PopupElement.Header>
        <PopupElement.Body>
          <Inner />
        </PopupElement.Body>
        <Show when={multiSelect !== 'disabled' || options.footer}>
          <PopupElement.Footer class="popup-forward-footer" floating>
            <FooterInner />
          </PopupElement.Footer>
        </Show>
      </PopupElement>
    );
  });

  return {
    get selector() {
      return selector;
    },
    get middleware() {
      return middleware;
    },
    hide() {
      setShow(false);
    },
    finalize
  };
}

export async function showPickUser2Popup<T extends boolean = false>({
  peerType,
  filterPeerTypeBy,
  chatRightsActions,
  multiSelect,
  limit,
  limitCallback,
  titleLangKey,
  placeholder,
  exceptSelf,
  excludePeerIds
}: {
  peerType?: SelectSearchPeerType[],
  filterPeerTypeBy: AppSelectPeers['filterPeerTypeBy'],
  chatRightsActions?: PopupPickUserOptions['chatRightsActions'],
  placeholder?: LangPackKey,
  multiSelect?: T,
  limit?: number,
  limitCallback?: () => void,
  titleLangKey?: LangPackKey,
  exceptSelf?: boolean,
  excludePeerIds?: PopupPickUserOptions['excludePeerIds']
}) {
  return new Promise<T extends false ? PeerId : PeerId[]>((resolve, reject) => {
    let resolved = false;
    const popup = showPickUserPopup({
      peerType,
      placeholder: placeholder || 'SelectChat',
      onSelect: (chosen) => {
        // The footer button stays clickable with an empty selection — treat
        // that as a cancel (onClose rejects) instead of resolving with [].
        if(!chosen.length) {
          return;
        }

        resolved = true;
        resolve((multiSelect ? chosen.map((c) => c.peerId) : chosen[0].peerId) as any);
      },
      multiSelect,
      // The batch is confirmed via the floating footer button, which needs a
      // label — an unlabeled FooterButton renders as an empty bar.
      footerButtonProps: multiSelect ? {langKey: 'Send'} : undefined,
      filterPeerTypeBy,
      chatRightsActions,
      titleLangKey,
      exceptSelf,
      excludePeerIds,
      onClose: () => {
        if(!resolved) {
          reject();
        }
      }
    });

    if(limit) {
      popup.selector?.setLimit(limit, limitCallback);
    }
  });
}

export async function showPickUser3Popup(
  types: Parameters<typeof AppSelectPeers['convertPeerTypes']>[0] = ['users', 'bots', 'groups', 'channels'],
  chatRightsActions?: PopupPickUserOptions['chatRightsActions']
) {
  if(!Array.isArray(types)) {
    types = [];
  }

  const filterPeerTypeBy: IsPeerType[] = AppSelectPeers.convertPeerTypes(types);
  const peerType: SelectSearchPeerType[] = ['dialogs'];
  if(types.includes('users')) peerType.push('contacts');

  if(!filterPeerTypeBy.length) {
    throw undefined;
  }

  return showPickUser2Popup({
    peerType,
    filterPeerTypeBy,
    chatRightsActions,
    titleLangKey: 'ShareWith'
  });
}

/**
 * A picker footer that offers the link until a recipient is ticked. Confirming
 * an empty selection is a dead button, and the link itself is what someone who
 * opened the picker and picked nobody still wants — so that is what the button
 * becomes. Shared by the conference invite picker and every `shareUrlToPeers`
 * batch; both feed the returned pair straight into their picker options.
 */
export function createCopyLinkFooter(options: {
  confirmLangKey: LangPackKey,
  copy: () => void,
  confirm: () => void
}): Pick<PopupPickUserOptions, 'footer' | 'onChange'> {
  const [selectedCount, setSelectedCount] = createSignal(0);

  return {
    onChange: (length) => setSelectedCount(length),
    footer: () => (
      <PopupElement.FooterButton
        confirm
        langKey={selectedCount() ? options.confirmLangKey : 'CopyLink'}
        callback={() => {
          if(selectedCount()) {
            options.confirm();
            return;
          }

          options.copy();
          // Copying is not done with the picker — a recipient may still follow.
          return false;
        }}
      />
    )
  };
}

export function showSharingPickerPopup(options: {
  onSelect: PopupPickUserOptions['onSelect'],
  chatRightsActions?: PopupPickUserOptions['chatRightsActions'],
  exceptSelf?: PopupPickUserOptions['exceptSelf'],
  placeholder?: LangPackKey,
  selfPresence?: LangPackKey,
  // Multi-select toggle for the picker. `true` ⇒ checkboxes, user confirms a
  // batch; `false` (default) ⇒ pick-and-send immediately. Pass-through to
  // AppSelectPeers' own `multiSelect` enum if a non-boolean is needed.
  multiSelect?: PopupPickUserOptions['multiSelect'],
  // Replace the floating confirm button — `shareUrlToPeers` swaps it for a
  // "copy the link" action while nothing is picked.
  footer?: PopupPickUserOptions['footer'],
  onChange?: PopupPickUserOptions['onChange'],
  onCloseAfterTimeout?: () => void,
  onClose?: () => void
}) {
  options.chatRightsActions ??= ['send_plain'];
  options.placeholder ??= 'ShareModal.Search.Placeholder';
  options.selfPresence ??= 'ChatYourSelf';
  return showPickUserPopup({
    titleLangKey: 'ShareWith',
    showTopPeers: true,
    // Default the floating footer button's label to "Send" — without this the
    // PopupElement.FooterButton renders as an empty purple bar in multi-select
    // mode (single-select callers complete via row click and never see it).
    footerButtonProps: {langKey: 'Send'},
    ...options,
    peerType: ['dialogs', 'contacts']
  });
}

export function showSharingPicker2Popup(options?: Modify<Parameters<typeof showSharingPickerPopup>[0], {onSelect?: never}>) {
  return new Promise<{peerId: PeerId}>((resolve, reject) => {
    let resolved = false;
    showSharingPickerPopup({
      ...(options || {}),
      onSelect: (chosen) => {
        resolved = true;
        resolve(chosen[0]);
      },
      onClose: () => {
        if(!resolved) {
          reject();
        }
      }
    });
  });
}

export function showReplyPickerPopup() {
  return showSharingPicker2Popup({
    placeholder: 'ReplyToDialog',
    selfPresence: 'SavedMessagesInfoQuote'
  });
}

export function showContactPickerPopup() {
  return new Promise<PeerId>((resolve, reject) => {
    let resolved = false;
    showPickUserPopup({
      titleLangKey: 'Contacts',
      peerType: ['contacts'],
      placeholder: 'Search',
      onSelect: (chosen) => {
        resolved = true;
        resolve(chosen[0].peerId);
      },
      onClose: () => {
        if(!resolved) {
          reject();
        }
      }
    });
  });
}
