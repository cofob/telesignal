import {createRoot} from 'solid-js';
import {createStore, SetStoreFunction} from 'solid-js/store';
import type ChatInput from '../input';
import useFileInput from './useFileInput';


export interface ChatInputStateStore {
  // * the messages the composer's text would go as
  messageCount: number;

  // * file input
  isEditing: boolean;
  isReplacingMedia: boolean;
}

export type ChatInputState = ReturnType<typeof createChatInputState>;

export type ChatInputStateContext = {
  instance: ChatInput;
  store: ChatInputStateStore;
  setStore: SetStoreFunction<ChatInputStateStore>;
};

const DEFAULT_STORE: ChatInputStateStore = {
  messageCount: 0,

  isEditing: false,
  isReplacingMedia: false
};

export default function createChatInputState(instance: ChatInput, initial: ChatInputStateStore = DEFAULT_STORE) {
  return createRoot((dispose) => {
    instance.getMiddleware()?.onDestroy(() => void dispose());

    const [store, set] = createStore<ChatInputStateStore>({...initial});

    const context: ChatInputStateContext = {instance, store, setStore: set};

    useFileInput(context);

    return {store, set, dispose};
  });
}
