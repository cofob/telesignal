import type {ReactionsContext} from '@appManagers/appReactionsManager';
import forEachReverse from '@helpers/array/forEachReverse';
import callbackifyAll from '@helpers/callbackifyAll';
import positionElementByIndex from '@helpers/dom/positionElementByIndex';
import {makeMediaSize} from '@helpers/mediaSize';
import {Middleware, MiddlewareHelper} from '@helpers/middleware';
import {ReactionCount, SavedReactionTag} from '@layer';
import reactionsEqual from '@appManagers/utils/reactions/reactionsEqual';
import {CustomEmojiRendererElement} from '@lib/customEmoji/renderer';
import rootScope from '@lib/rootScope';
import {AnimationItemGroup} from '@components/animationIntersector';
import LazyLoadQueue from '@components/lazyLoadQueue';
import ReactionElement, {ReactionLayoutType, REACTIONS_DISPLAY_COUNTER_AT, REACTIONS_SIZE} from '@components/chat/reaction';
import {getHeavyAnimationPromise} from '@hooks/useHeavyAnimationCheck';
import pause from '@helpers/schedulers/pause';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {hotListen} from '@helpers/hotModule';
import {isReactionFlightHeld, launchReactionFlight} from '@components/chat/reactionFlight';


const CLASS_NAME = 'reactions';
const TAG_NAME = CLASS_NAME + '-element';

const REACTIONS_ELEMENTS: Map<string, Set<ReactionsElement>> = new Map();
export {REACTIONS_ELEMENTS};

export const savedReactionTags: SavedReactionTag[] = [];
hotListen(import.meta.hot, rootScope, 'saved_tags', ({savedPeerId, tags}) => {
  if(savedPeerId) {
    return;
  }

  savedReactionTags.splice(0, savedReactionTags.length, ...tags);

  REACTIONS_ELEMENTS.forEach((set) => {
    set.forEach((reactionsElement) => {
      const context = reactionsElement.getContext();
      if(context.peerId === rootScope.myId && reactionsElement.getType() === ReactionLayoutType.Tag) {
        reactionsElement.render();
      }
    });
  });
});

export default class ReactionsElement extends HTMLElement {
  public static create() {
    // the registered class: after a hot update this module's class is a copy, which the element registry does not know
    return new (customElements.get(TAG_NAME) as typeof ReactionsElement)();
  }

  private context: ReactionsContext;
  private key: string;
  private isPlaceholder: boolean;
  private type: ReactionLayoutType;
  private sorted: ReactionElement[];
  private onConnectCallback: () => void;
  private middleware: Middleware;
  private middlewareHelpers: Map<ReactionElement, MiddlewareHelper>;
  public customEmojiRenderer: CustomEmojiRendererElement;
  private customEmojiRendererMiddlewareHelper: MiddlewareHelper;
  private animationGroup: AnimationItemGroup;
  private lazyLoadQueue: LazyLoadQueue;
  private forceCounter: boolean;

  constructor() {
    super();
    this.classList.add(CLASS_NAME);
    this.sorted = [];
    this.middlewareHelpers = new Map();
  }

  connectedCallback() {
    // * a row made for no message (a picture of one, `copyElement`, put in the page while a bubble changes) is
    // * no row of any: not registered, nor raising a bubble for an effect
    if(this.key === undefined) {
      return;
    }

    let set = REACTIONS_ELEMENTS.get(this.key);
    if(!set) {
      REACTIONS_ELEMENTS.set(this.key, set = new Set());
    }

    set.add(this);

    if(this.onConnectCallback && this.isConnected) {
      this.onConnectCallback();
      this.onConnectCallback = undefined;
    }
  }

  disconnectedCallback() {
    if(this.key === undefined) {
      return;
    }

    const set = REACTIONS_ELEMENTS.get(this.key);
    set.delete(this);
    if(!set.size) {
      REACTIONS_ELEMENTS.delete(this.key);
    }
  }

  public getType() {
    return this.type;
  }

  public getReactionCount(reactionElement: ReactionElement) {
    return this.sorted[this.sorted.indexOf(reactionElement)].reactionCount;
  }

  public getContext() {
    return this.context;
  }

  public getSorted() {
    return this.sorted;
  }

  // * TeleSignal: Signal has no saved tags, so Note to Self has plain reactions
  public shouldUseTagsForContext(context: ReactionsElement['context']) {
    return false;
  }

  public init({
    context,
    type,
    middleware,
    isPlaceholder = this.isPlaceholder,
    animationGroup,
    lazyLoadQueue,
    forceCounter
  }: {
    context: ReactionsContext,
    type: ReactionLayoutType,
    middleware: Middleware,
    isPlaceholder?: boolean,
    animationGroup?: AnimationItemGroup,
    lazyLoadQueue?: LazyLoadQueue,
    forceCounter?: boolean
  }) {
    if(this.key !== undefined) {
      this.disconnectedCallback();
    }

    if(this.middleware !== middleware) {
      middleware.onDestroy(() => {
        this.middlewareHelpers.clear();
      });
    }

    this.context = context;
    this.key = this.context.peerId + '_' + this.context.mid;
    this.middleware = middleware;
    this.isPlaceholder = isPlaceholder;
    this.animationGroup = animationGroup;
    this.lazyLoadQueue = lazyLoadQueue;
    this.forceCounter = forceCounter;

    this.setType(type);

    this.connectedCallback();
  }

  public setType(type: ReactionLayoutType) {
    if(type === ReactionLayoutType.Block && this.shouldUseTagsForContext(this.context)) {
      type = ReactionLayoutType.Tag;
    }

    if(this.type === type) {
      return;
    }

    this.type = type;

    for(const type in ReactionLayoutType) {
      this.classList.remove(CLASS_NAME + '-' + type);
    }

    this.classList.add(CLASS_NAME + '-' + type);
    this.classList.toggle(CLASS_NAME + '-like-block', type === ReactionLayoutType.Block || type === ReactionLayoutType.Tag);
  }

  public changeContext(context: ReactionsContext) {
    return this.init({
      context,
      type: this.type,
      middleware: this.middleware
    });
  }

  public update(context: ReactionsContext, changedResults?: ReactionCount[], waitPromise?: Promise<any>) {
    this.context = context;
    this.render(changedResults, waitPromise);
  }

  public render(changedResults?: ReactionCount[], waitPromise?: Promise<any>) {
    const reactions = this.context.reactions;
    const hasReactions = !!(reactions && reactions.results.length);
    this.classList.toggle('has-no-reactions', !hasReactions);
    if(!hasReactions && !this.sorted.length) return;

    // const availableReactionsResult = this.managers.appReactionsManager.getAvailableReactions();
    // callbackify(availableReactionsResult, () => {
    const counts = hasReactions ? (
      reactions.results
        // availableReactionsResult instanceof Promise ?
        //   reactions.results :
        //   reactions.results.filter((reactionCount) => {
        //     return this.managers.appReactionsManager.isReactionActive(reactionCount.reaction);
        //   })
      ) : [];

    // counts = counts.filter((count) => count.reaction._ !== 'reactionPaid');

    // if(this.context.peerId.isUser()) {
    //   counts.sort((a, b) => (b.count - a.count) || ((b.chosen_order ?? 0) - (a.chosen_order ?? 0)));
    // } else {
    // counts.sort((a, b) => (b.count - a.count) || ((a.chosen_order ?? 0) - (b.chosen_order ?? 0)));
    // }

    forEachReverse(this.sorted, (reactionElement, idx, arr) => {
      const reaction = reactionElement.reactionCount.reaction;
      const found = counts.some((reactionCount) => reactionsEqual(reactionCount.reaction, reaction));
      if(!found) {
        const middlewareHelper = this.middlewareHelpers.get(reactionElement);
        middlewareHelper.destroy();
        this.middlewareHelpers.delete(reactionElement);
        arr.splice(idx, 1);
        reactionElement.remove();
      }
    });

    let animationShouldHaveDelay = false;
    const totalReactions = counts.reduce((acc, c) => acc + c.count, 0);
    const canRenderAvatars = reactions &&
      (!!reactions.pFlags.can_see_list || this.context.peerId.isUser()) &&
      totalReactions < REACTIONS_DISPLAY_COUNTER_AT[this.type];
    const customEmojiElements: ReturnType<ReactionElement['render']>[] = new Array(counts.length);
    // the reactions it did not show before
    const created: Set<ReactionElement> = new Set();
    this.sorted = counts.map((reactionCount, idx, arr) => {
      let reactionElement: ReactionElement = this.sorted.find((reactionElement) => reactionsEqual(reactionElement.reactionCount.reaction, reactionCount.reaction));
      if(!reactionElement) {
        const middlewareHelper = this.middleware.create();
        reactionElement = ReactionElement.create();
        reactionElement.init(this.type, middlewareHelper.get());
        this.middlewareHelpers.set(reactionElement, middlewareHelper);
        created.add(reactionElement);
      }

      reactionElement.classList.toggle('is-last', idx === (arr.length - 1));

      const recentReactions = reactions.recent_reactions ?
        reactions.recent_reactions.filter((reaction) => reactionsEqual(reaction.reaction, reactionCount.reaction)) :
        [];
      const wasUnread = reactionElement.isUnread;
      const isUnread = recentReactions.some((reaction) => reaction.pFlags.unread);
      reactionElement.reactionCount = reactionCount;
      reactionElement.setCanRenderAvatars(canRenderAvatars);
      const customEmojiElement = reactionElement.render(this.isPlaceholder);
      reactionElement.renderCounter(this.forceCounter);
      reactionElement.renderAvatars(recentReactions);
      reactionElement.isUnread = isUnread;
      reactionElement.setIsChosen();

      if(wasUnread && !isUnread && !changedResults?.includes(reactionCount)) {
        (changedResults ??= []).push(reactionCount);
        animationShouldHaveDelay = true;
      }

      customEmojiElements[idx] = customEmojiElement;

      return reactionElement;
    });

    this.sorted.forEach((element, idx) => {
      positionElementByIndex(element, this, idx);
    });

    // a reaction chosen for it flies to where it ends, once that is laid out: after the change it is made in, which
    // the list is kept in place around, and before the change is shown
    if(!this.isPlaceholder && isReactionFlightHeld(this.key)) {
      queueMicrotask(() => this.launchFlight(created));
    }

    callbackifyAll(customEmojiElements, (customEmojiElements) => {
      const map: Parameters<CustomEmojiRendererElement['add']>[0]['addCustomEmojis'] = new Map();
      customEmojiElements.forEach((customEmojiElement) => {
        if(!customEmojiElement) {
          return;
        }

        map.set(customEmojiElement.docId, new Set([customEmojiElement]));
      });

      if(!map.size) {
        if(this.customEmojiRenderer) {
          this.customEmojiRendererMiddlewareHelper.destroy();
          this.customEmojiRenderer.remove();
          this.customEmojiRenderer =
            this.customEmojiRendererMiddlewareHelper =
            undefined;
        }

        return;
      }

      if(!this.customEmojiRenderer) {
        const size = REACTIONS_SIZE[this.type];
        this.customEmojiRendererMiddlewareHelper = this.middleware.create();
        this.customEmojiRenderer = CustomEmojiRendererElement.create({
          animationGroup: this.animationGroup,
          customEmojiSize: makeMediaSize(size, size),
          middleware: this.customEmojiRendererMiddlewareHelper.get(),
          lazyLoadQueue: this.lazyLoadQueue,
          observeResizeElement: this
        });

        this.customEmojiRenderer.classList.add(CLASS_NAME + '-renderer');
        this.customEmojiRenderer.canvas.classList.add(CLASS_NAME + '-renderer-canvas');
        this.prepend(this.customEmojiRenderer);
      }

      this.customEmojiRenderer.add({
        addCustomEmojis: map,
        lazyLoadQueue: this.lazyLoadQueue
      });
    });

    if(!this.isPlaceholder && changedResults?.length) {
      if(this.isConnected) {
        this.handleChangedResults(changedResults, waitPromise, animationShouldHaveDelay);
      } else {
        this.onConnectCallback = () => {
          this.handleChangedResults(changedResults, waitPromise, animationShouldHaveDelay);
        };
      }
    }
  }

  private launchFlight(created: Set<ReactionElement>) {
    const element = this.isConnected && this.sorted.find(({reactionCount}) => {
      return reactionCount.chosen_order !== undefined && isReactionFlightHeld(this.key, reactionCount.reaction);
    });
    if(!element) {
      return;
    }

    const flight = element.flight = launchReactionFlight({
      key: this.key,
      reaction: element.reactionCount.reaction,
      target: element.stickerContainer,
      // one it showed before shows on as the flight lands on it (ReactionsLayoutInBubble's drawImage)
      hide: created.has(element) ? () => this.hideSticker(element) : undefined
    });
    flight?.landed.then(() => {
      if(element.flight === flight) {
        element.flight = undefined;
      }
    });
  }

  // a reaction's emoji hidden, and what shows it again; a custom one is drawn by the row's canvas, which leaves out
  // what is not laid out
  private hideSticker(element: ReactionElement) {
    const {stickerContainer} = element;
    const customEmoji = stickerContainer.querySelector<HTMLElement>('custom-emoji-element');
    stickerContainer.style.visibility = 'hidden';
    if(customEmoji) {
      customEmoji.style.display = 'none';
      this.customEmojiRenderer?.forceRender();
    }

    return () => {
      stickerContainer.style.removeProperty('visibility');
      if(customEmoji) {
        customEmoji.style.removeProperty('display');
        this.customEmojiRenderer?.forceRender();
      }
    };
  }

  private async handleChangedResults(changedResults: ReactionCount[], waitPromise?: Promise<any>, withDelay?: boolean) {
    await getHeavyAnimationPromise();
    // ! temp
    const isShown = () => this.context.peerId === hotReloadGuard.appImManager.chat.peerId;
    const getElement = (reactionCount: ReactionCount) => this.sorted.find((reactionElement) => {
      return reactionsEqual(reactionElement.reactionCount.reaction, reactionCount.reaction);
    });

    // one flown to plays as its flight comes near and lands: it loads meanwhile, and takes its place as it starts
    const flown = changedResults.filter((reactionCount) => getElement(reactionCount)?.flight);
    if(isShown()) flown.forEach((reactionCount) => {
      const element = getElement(reactionCount);
      element.fireAroundAnimation(element.flight.hit, element.flight.landed);
    });

    // the others play as they are chosen, loading meanwhile, and keep to their reaction while the bubble is shown
    // changing around it (`waitPromise`); one read plays a moment after it stands where it ends
    if(!isShown()) return;
    const playPromise = withDelay ? Promise.resolve(waitPromise).then(() => pause(150)) : undefined;
    changedResults.forEach((reactionCount) => {
      if(!flown.includes(reactionCount)) {
        getElement(reactionCount)?.fireAroundAnimation(playPromise, undefined, waitPromise);
      }
    });
  }
}

if(!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, ReactionsElement);
}

// a method edited here takes effect on the reactions on screen, without a reload (see @helpers/hotRegistry)
if(import.meta.hot) import.meta.hot.accept();
