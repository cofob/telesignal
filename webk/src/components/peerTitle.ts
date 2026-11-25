import rootScope from '@lib/rootScope';
import {i18n} from '@lib/langPack';
import replaceContent from '@helpers/dom/replaceContent';
import {HIDDEN_PEER_ID, NULL_PEER_ID} from '@appManagers/constants';
import limitSymbols from '@helpers/string/limitSymbols';
import setInnerHTML, {setDirection} from '@helpers/dom/setInnerHTML';
import safeAssign from '@helpers/object/safeAssign';
import wrapEmojiText from '@lib/richTextProcessor/wrapEmojiText';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import generateTitleIcons from '@components/generateTitleIcons';
import lottieLoader from '@lib/lottie/lottieLoader';
import buildURLHash from '@helpers/buildURLHash';
import Modes from '@config/modes';
import {hotListen} from '@helpers/hotModule';
import type {ActiveAccountNumber} from '@lib/accounts/types';

export type PeerTitleOptions = {
  peerId?: PeerId,
  fromName?: string,
  plainText?: boolean,
  onlyFirstName?: boolean,
  username?: boolean,
  dialog?: boolean,
  limitSymbols?: number,
  withIcons?: boolean,
  withPremiumIcon?: boolean,
  /** with `withIcons`: no emoji status or premium star, whatever the middleware */
  noPremiumIcon?: boolean,
  clickableEmojiStatus?: boolean,
  threadId?: number,
  meAsNotes?: boolean,
  iconsColor?: string,
  wrapOptions?: WrapSomethingOptions,
  /**
   * A name that opens its peer on click (a sender's in a message): an `<a href="#<peerId>">`, as a
   * mention of the peer in a message is — the route opens the peer. Read once, by the constructor.
   */
  link?: boolean,
  /** The account the peer is of, when the tab may show another one meanwhile (a call's). */
  accountNumber?: ActiveAccountNumber
};

const weakMap: WeakMap<HTMLElement, PeerTitle> = new WeakMap();

hotListen(import.meta.hot, rootScope, 'peer_title_edit', ({peerId, threadId}) => {
  let query = `.peer-title[data-peer-id="${peerId}"]`;
  if(threadId) {
    query += `[data-thread-id="${threadId}"]`;
  }

  const elements = Array.from(document.querySelectorAll(query)) as HTMLElement[];
  elements.forEach((element) => {
    const peerTitle = weakMap.get(element);
    peerTitle?.update();
  });
});

export default class PeerTitle {
  public element: HTMLElement;
  public options: PeerTitleOptions;
  /** the first render, started by the constructor */
  public ready: Promise<void>;
  private hasInner: boolean;

  constructor(options?: PeerTitleOptions) {
    this.element = document.createElement(options?.link ? 'a' : 'span');
    this.element.classList.add('peer-title');
    setDirection(this.element);
    if(options?.link) {
      // * a stop of its own only for the keyboard layer, and not dragged off as a link: a name
      if(!Modes.a11y) this.element.tabIndex = -1;
      this.element.draggable = false;
      // * whoever shows the name opens the peer (onBubblesClick — on mousedown on a touch device, so
      // * the click comes after): only a Ctrl or Cmd click follows the href, into a new tab
      this.element.addEventListener('click', (e) => {
        if(!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
        }
      });
    }

    this.options = {};

    if(options) {
      // * settles whatever the render comes to: a bubble's render waits for it with the rest of its
      // * loads, and a rejection would end that wait for all of them at once
      this.ready = this.update(options).catch((err) => {
        console.error('peer title render failed', err);
      });
    }

    weakMap.set(this.element, this);
  }

  public setOptions(options?: PeerTitleOptions) {
    if(!options) {
      return;
    }

    safeAssign(this.options, options);
    for(const i in options) {
      // @ts-ignore
      const value = options[i];

      if(typeof(value) !== 'object' && typeof(value) !== 'function') {
        // @ts-ignore
        this.element.dataset[i] = value ? '' + (typeof(value) === 'boolean' ? +value : value) : '0';
      }
    }
  }

  private setHasInner(hasInner: boolean) {
    if(this.hasInner !== hasInner) {
      this.hasInner = hasInner;
      this.element.classList.toggle('with-icons', hasInner);
    }
  }

  public async update(options?: PeerTitleOptions) {
    this.setOptions(options);

    let fromName = this.options.fromName;
    if(fromName !== undefined) {
      if(this.options.limitSymbols !== undefined) {
        fromName = limitSymbols(fromName, this.options.limitSymbols, this.options.limitSymbols);
      }

      setInnerHTML(this.element, wrapEmojiText(fromName));
      return;
    }

    this.options.peerId ??= NULL_PEER_ID;
    if(this.element.tagName === 'A') {
      const peerId = this.options.peerId;
      if(peerId === NULL_PEER_ID || peerId === HIDDEN_PEER_ID) {
        this.element.removeAttribute('href');
      } else {
        (this.element as HTMLAnchorElement).href = buildURLHash('' + peerId);
      }
    }

    let hasInner: boolean;
    const {peerId} = this.options;
    if(peerId === rootScope.myId && this.options.dialog) {
      let element: HTMLElement;
      if(this.options.meAsNotes) {
        element = i18n(this.options.onlyFirstName ? 'MyNotesShort' : 'MyNotes');
      } else {
        element = i18n(this.options.onlyFirstName ? 'Saved' : 'SavedMessages');
      }

      replaceContent(this.element, element);
    } else if(peerId === HIDDEN_PEER_ID) {
      replaceContent(this.element, i18n(this.options.onlyFirstName ? 'AuthorHiddenShort' : 'AuthorHidden'));
    } else {
      const [title, icons] = await Promise.all([
        getPeerTitle({
          ...this.options as Required<PeerTitleOptions>,
          peerId
        }),
        (this.options.withIcons && generateTitleIcons({peerId, clickableEmojiStatus: this.options.clickableEmojiStatus, noPremiumIcon: this.options.noPremiumIcon, wrapOptions: {...this.options.wrapOptions, textColor: this.options.iconsColor || this.options.wrapOptions?.textColor}})) ||
          (this.options.withPremiumIcon && generateTitleIcons({peerId, wrapOptions: {...this.options.wrapOptions, textColor: this.options.iconsColor || this.options.wrapOptions?.textColor}, noVerifiedIcon: true, noFakeIcon: true}))
      ]);

      const createInnerTitleSpan = () => {
        const inner = document.createElement('span');
        inner.classList.add('peer-title-inner');
        hasInner = true;
        setInnerHTML(inner, title);

        return inner;
      };

      const setElementContent = (nodes: (Node | string)[]) => {
        const fragment = document.createDocumentFragment();
        fragment.append(...nodes);

        setInnerHTML(this.element, fragment);
      }

      if(icons?.elements?.length || icons?.botVerification) {
        setElementContent(
          [
            icons.botVerification, createInnerTitleSpan(), ...(icons.elements ?? [])
          ].filter(Boolean)
        );
      } else {
        setInnerHTML(this.element, title);
      }
    }

    this.setHasInner(hasInner);
  }
}

/**
 * A `PeerTitle` built during a render: the render waits for its `ready` (`loadPromises`), so what it is drawn
 * into is laid out with the name already in it
 */
export function createPeerTitleElement(options: PeerTitleOptions, loadPromises?: Promise<any>[]) {
  const peerTitle = new PeerTitle(options);
  loadPromises?.push(peerTitle.ready);
  return peerTitle.element;
}

export function changeTitleEmojiColor(element: HTMLElement, color: string) {
  const elements = element.querySelectorAll<HTMLElement>('.emoji-status-text-color');
  elements.forEach((emojiStatus) => {
    const player = emojiStatus && lottieLoader.getAnimation(emojiStatus);
    if(player) {
      player.setColor(color, true);
    }
  })
}

// a method edited here takes effect on the titles on screen, without a reload (see @helpers/hotRegistry)
if(import.meta.hot) import.meta.hot.accept();
