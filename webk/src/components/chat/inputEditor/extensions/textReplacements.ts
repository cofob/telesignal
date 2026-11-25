import {Extension, InputRule} from '@tiptap/core';
import {getShouldReplaceTextShortcuts, TEXT_REPLACEMENTS} from '@lib/signal/textReplacements';

/** TeleSignal: `--`, `<<`, `>>` and `:shrug:` turn into what they stand for as they are typed, as in Web A */
export const ChatTextReplacements = Extension.create({
  name: 'chatTextReplacements',

  addInputRules() {
    return TEXT_REPLACEMENTS.map(({find, replacement}) => new InputRule({
      find,
      handler: ({state, range}) => {
        // * a rule that changes nothing leaves the typed text as it is
        if(!getShouldReplaceTextShortcuts()) return null;
        state.tr.insertText(replacement, range.from, range.to);
      }
    }));
  }
});
