/*
 * TeleSignal: the formatting a message field offers. Signal's text styles (`BodyRange.Style` of Signal Desktop) are
 * bold, italic, strikethrough, monospace and spoiler; a message has no underline, quote or formatted link.
 */

import type {MarkupTooltipTypes} from '@components/chat/markupTooltip';

export const SIGNAL_MESSAGE_FORMATTING: MarkupTooltipTypes[] = ['bold', 'italic', 'strikethrough', 'monospace', 'spoiler'];
