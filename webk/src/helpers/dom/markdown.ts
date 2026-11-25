import MarkupTooltip from '@components/chat/markupTooltip';
import cancelEvent from '@helpers/dom/cancelEvent';
import {MarkdownType} from '@helpers/dom/getRichElementValue';
import isSelectionEmpty from '@helpers/dom/isSelectionEmpty';
import {getChatInputEditor} from '@components/chat/inputEditor/registry';
import openCreateLinkPopupForInput from '@components/popups/createLinkForInput';
import {IS_APPLE} from '@environment/userAgent';

/**
 * Formatting is applied by the editor mounted on the input.
 *
 * Every field that can be formatted mounts one — the chat composer, media
 * captions, forward comments, poll descriptions, fact checks — so there is no
 * second implementation to keep in step. This used to fall back to
 * `document.execCommand` with its own markup bookkeeping.
 */
export function applyMarkdown({input, type, href, dateSuffix}: {
  input: HTMLElement,
  type: MarkdownType,
  href?: string,
  dateSuffix?: string
}) {
  const editor = getChatInputEditor(input);
  if(!editor) return false;

  const applied = editor.applyMarkup({type, href, dateSuffix});
  MarkupTooltip.getInstance().setActiveMarkupButton();
  return applied;
}

/**
 * Whether only the modifier of the editor's shortcuts is held: Ctrl, or Cmd on a Mac. Anything on top of it is
 * not the editor's: with Shift or Alt the keys are the browser's (Ctrl+Shift+I its DevTools, Ctrl+Shift+P a
 * private window, Cmd+Option+U the page's source), Ctrl on a Mac is the system's text editing (Ctrl+K deletes
 * to the end of the line), and Ctrl+Alt on Windows is AltGr typing a letter (the Polish ś)
 */
export function isEditorShortcutModifier(e: KeyboardEvent) {
  return (IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.shiftKey && !e.altKey;
}

const FORMAT_KEYS: {[code: string]: MarkdownType} = {
  'KeyB': 'bold',
  'KeyI': 'italic',
  'KeyU': 'underline',
  'KeyS': 'strikethrough',
  'KeyK': 'link',
  // * TeleSignal: Web A's monospace (Mod+M) and spoiler (Mod+P) of a selection (`src/util/keyboardShortcuts/registry.ts`)
  'KeyM': 'monospace',
  'KeyP': 'spoiler'
};

// * Web A's Mod+Shift+M and Mod+Shift+P, which also format a selection
const SHIFT_FORMAT_KEYS: {[code: string]: MarkdownType} = {
  'KeyM': 'monospace',
  'KeyP': 'spoiler'
};

// * what a contenteditable formats by itself on its key
const SELF_FORMATTING_TYPES = new Set<MarkdownType>(['bold', 'italic', 'underline']);

function getMarkdownTypeOfShortcut(e: KeyboardEvent) {
  if(isEditorShortcutModifier(e)) return FORMAT_KEYS[e.code];
  const isModShift = (IS_APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && e.shiftKey && !e.altKey;
  return isModShift ? SHIFT_FORMAT_KEYS[e.code] : undefined;
}

export function handleMarkdownShortcut(input: HTMLElement, e: KeyboardEvent) {
  const markdownType = getMarkdownTypeOfShortcut(e);
  if(!markdownType) return;
  const selection = input.ownerDocument.defaultView.getSelection();
  if(isSelectionEmpty(selection)) return;

  if(markdownType === 'link') {
    // a field that declared no links leaves Ctrl+K to the browser
    if(!getChatInputEditor(input)?.supportsMarkup('link')) return;
    void openCreateLinkPopupForInput(input);
  } else if(!applyMarkdown({input, type: markdownType}) && !SELF_FORMATTING_TYPES.has(markdownType)) {
    // nor is Ctrl+S (the browser's Save), Ctrl+M or Ctrl+P (Print) taken where there is nothing to make; Ctrl+B, I
    // and U format a contenteditable by themselves, past the field's schema, and stay cancelled
    return;
  }

  cancelEvent(e); // cancel the browser's own formatting shortcut
}
