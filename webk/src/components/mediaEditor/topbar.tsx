import {batch, onCleanup, onMount} from 'solid-js';

import {bindActiveWindowListener} from '@helpers/appWindow';
import {getIsKeyboardShortcut} from '@lib/keyboardShortcuts';
import I18n, {i18n} from '@lib/langPack';
import {ButtonIconTsx} from '@components/buttonIconTsx';
import ripple from '@components/ripple';

import {HistoryItem, useMediaEditorContext} from '@components/mediaEditor/context';
import {processHistoryItem} from '@components/mediaEditor/utils';
import A11yButton from '@components/a11yButton';

export default function Topbar(props: {onClose: () => void; onFinish: () => void}) {
  const {canFinish, mediaState, editorState} = useMediaEditorContext();

  let doneButton: HTMLElement;


  function processHistory(history: HistoryItem[], otherHistory: HistoryItem[]) {
    batch(() => {
      const item = history.pop();
      if(!item) return;

      otherHistory.push({
        ...item,
        path: item.path,
        newValue: item.oldValue,
        oldValue: item.newValue
      });

      processHistoryItem(item, mediaState);

      editorState.selectedResizableLayer = undefined;
    });
  }

  function onUndo() {
    processHistory(mediaState.history, mediaState.redoHistory);
  }

  function onRedo() {
    processHistory(mediaState.redoHistory, mediaState.history);
  }

  onMount(() => {
    ripple(doneButton);

    // * Web A's undo and redo of the media editor, by its registry (`lib/keyboardShortcuts`)
    const removeListener = bindActiveWindowListener((w) => w.document, 'keydown', (e: KeyboardEvent) => {
      if(getIsKeyboardShortcut(e, 'mediaEditorUndo')) {
        e.preventDefault();
        onUndo();
      } else if(getIsKeyboardShortcut(e, 'mediaEditorRedo')) {
        e.preventDefault();
        onRedo();
      }
    });

    onCleanup(() => removeListener());
  });

  return (
    <div class="media-editor__topbar">
      <ButtonIconTsx icon="cross" onClick={props.onClose} aria-label={I18n.format('Close', true)} />
      <div class="media-editor__topbar-title">{i18n('Edit')}</div>
      <div class="media-editor__topbar-history-controls">
        <ButtonIconTsx disabled={!mediaState.history.length} onClick={onUndo} icon="undo" aria-label={I18n.format('Undo', true)} />
        <ButtonIconTsx disabled={!mediaState.redoHistory.length} onClick={onRedo} icon="redo" aria-label={I18n.format('KeyboardShortcuts.Action.Redo', true)} />
      </div>
      <A11yButton
        ref={(el: HTMLElement) => doneButton = el}
        class="media-editor__topbar-done"
        classList={{
          'media-editor__topbar-done--disabled': !canFinish()
        }}
        disabled={!canFinish()}
        aria-label={I18n.format('Done', true)}
        onClick={() => {
          if(canFinish()) props.onFinish();
        }}
      >
        {i18n('Done')}
      </A11yButton>
    </div>
  );
}
