import MarkupTooltip from '@components/chat/markupTooltip';
import cancelEvent from '@helpers/dom/cancelEvent';
import {MarkdownType} from '@helpers/dom/getRichElementValue';
import isSelectionEmpty from '@helpers/dom/isSelectionEmpty';
import {getChatInputEditor} from '@components/chat/inputEditor/registry';
import openCreateLinkPopupForInput from '@components/popups/createLinkForInput';
import {getIsKeyboardShortcut} from '@lib/keyboardShortcuts';
import type {KeyboardShortcutId} from '@signal-app/keyboard-shortcuts';

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

// * TeleSignal: the formatting of a selection by Web A's shortcuts and its user's changes of them (`lib/keyboardShortcuts`)
const FORMAT_SHORTCUTS: [KeyboardShortcutId, MarkdownType][] = [
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['underline', 'underline'],
  ['strikethrough', 'strikethrough'],
  ['monospace', 'monospace'],
  ['spoiler', 'spoiler'],
  ['link', 'link']
];

// * what a contenteditable formats by itself on its key
const SELF_FORMATTING_TYPES = new Set<MarkdownType>(['bold', 'italic', 'underline']);

function getMarkdownTypeOfShortcut(e: KeyboardEvent) {
  return FORMAT_SHORTCUTS.find(([id]) => getIsKeyboardShortcut(e, id))?.[1];
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
