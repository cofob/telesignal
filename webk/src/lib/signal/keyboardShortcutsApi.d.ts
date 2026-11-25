/*
 * TeleSignal: Web A's registry of keyboard shortcuts (`src/util/keyboardShortcuts/registry.ts`), which Web K takes as it
 * is (`@signal-app/keyboard-shortcuts`), so both frontends have the same ids, defaults and editable shortcuts. Web K's
 * type check cannot include Web A's sources: `src/api/signal/webkContract.ts` checks this description against them.
 */

export type KeyboardShortcutId =
  'globalSearch' | 'quickChatPicker' | 'savedMessages' | 'archivedChats' | 'openSettings' | 'lockScreen' | 'quitApp'
  | 'closeOrGoBack'
  | 'previousChat' | 'nextChat' | 'openChatByNumber' | 'openFolderByNumber'
  | 'searchInChat' | 'focusMessageInput' | 'editLastMessage' | 'replyToPreviousMessage' | 'replyToNextMessage'
  | 'collapseRichInput' | 'copySelectedMessages' | 'deleteSelectedMessages' | 'copyFormats' | 'pauseVoiceRecording'
  | 'sendMessage' | 'newLine'
  | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'monospace' | 'spoiler' | 'link' | 'date' | 'blockquote'
  | 'clearFormatting' | 'subscript' | 'superscript' | 'paragraph' | 'headings' | 'codeBlock' | 'bulletList'
  | 'orderedList' | 'undo' | 'redo'
  | 'toggleRoundVideoPlayback' | 'exitRoundVideoFullscreen'
  | 'closeMediaViewer' | 'previousMedia' | 'nextMedia' | 'toggleVideoPlayback' | 'seekVideo'
  | 'closeStoryViewer' | 'toggleStoryPlayback' | 'previousStory' | 'nextStory'
  | 'closeMediaEditor' | 'mediaEditorUndo' | 'mediaEditorRedo' | 'deleteLayer'
  | 'mediaEditorPlayback' | 'mediaEditorSeek' | 'mediaEditorFrameStep' | 'mediaEditorMute';

export type KeyboardShortcutScope =
  'global' | 'chatList' | 'chat' | 'composer' | 'messageSelection' | 'mediaViewer' | 'storyViewer' | 'mediaEditor';

export type KeyboardShortcutCondition = 'hasSelection' | 'noSelection' | 'isInputEmpty';

export type KeyboardShortcutSection =
  'sending' | 'general' | 'chatList' | 'chat' | 'formatting' | 'roundVideo' | 'mediaViewer' | 'storyViewer'
  | 'mediaEditor';

export type KeyboardShortcutDefault = {
  combo: string,
  condition?: KeyboardShortcutCondition,
  platform?: 'mac' | 'windows',
  environment?: 'app' | 'notFirefox' | 'notMacApp' | 'notMacTauri',
  sendKeyCombo?: 'enter' | 'ctrl-enter'
};

export type KeyboardShortcut = {
  section: KeyboardShortcutSection,
  scope: KeyboardShortcutScope,
  titleKey: string,
  descriptionKey?: string,
  condition?: KeyboardShortcutCondition,
  isEditable?: true,
  defaults: KeyboardShortcutDefault[],
  displayKeys?: string[]
};

export const EXTENDED_MENU_KEY: string;
export const KEYBOARD_SHORTCUT_SECTIONS: {section: KeyboardShortcutSection, titleKey: string, descriptionKey?: string}[];
export const KEYBOARD_SHORTCUTS: Record<KeyboardShortcutId, KeyboardShortcut>;
export const KEYBOARD_SHORTCUT_IDS: KeyboardShortcutId[];
export const TEXT_EDITING_COMBOS: string[];
