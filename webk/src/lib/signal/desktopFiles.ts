/*
 * TeleSignal: downloads in the desktop app, as Web A's `src/util/tauri/nativeFiles.ts` makes them. The system webviews
 * do not download blobs reliably, so the app refuses the webview's downloads and saves the files that the page sends
 * it in chunks (`tauri/src/files.rs`): into the Downloads folder, or where a save dialog says when Web A's "Ask where
 * to save each file" setting is on. A toast then offers to open the file or show it in the file manager.
 */

import {invoke} from '@tauri-apps/api/core';
import {toast, toastNew} from '@components/toast';
import anchorCallback from '@helpers/dom/anchorCallback';
import {I18n, i18n, LangPackKey} from '@lib/langPack';
import {readWebASharedSettings, WebASharedSettings} from '@lib/signal/webAState';
import noop from '@helpers/noop';
import {IS_APPLE} from '@environment/userAgent';
import {randomLong} from '@helpers/random';

type SavedFileInfo = {
  fileName: string,
  folderName: string
};

type SavedFileOutcome = 'done' | 'missing' | 'cancelled';

// * the app writes the chunks into the file as they arrive
const CHUNK_BYTES = 2 * 1024 * 1024;
const SAVE_ID_HEADER = 'save-id';
const SAVED_TOAST_DURATION_MS = 8000;
const IS_WINDOWS = navigator.userAgent.includes('Windows');

// * saves run one at a time: each can open a save dialog, and the app limits the saves in progress
let saveQueue = Promise.resolve();

/** Saves the file of a blob URL through the app; settles once the app has it or the save failed or was cancelled */
export function saveDesktopFile(url: string, fileName: string) {
  saveQueue = saveQueue.then(() => runSave(url, fileName));
  return saveQueue;
}

/** Drops the app's records of saved files, which hold their paths, when an account logs out; the files stay */
export function forgetDesktopSavedFiles() {
  return invoke<void>('forget_saved_files');
}

/** Never rejects, so that a failed save does not stop the ones after it */
async function runSave(url: string, fileName: string) {
  let saveId: number | undefined;
  try {
    const {shouldAskWhereToSave} = await readWebASharedSettings().catch((): WebASharedSettings => ({}));
    // * the app records the file under a key, which the actions on it name
    const key = 'k' + randomLong();
    saveId = await invoke<number | null>('begin_file_save', {
      fileName,
      key,
      shouldAskWhere: !!shouldAskWhereToSave,
      dialogTitle: I18n.format('Signal.Desktop.SaveDialogTitle', true)
    }) ?? undefined;
    // * the user cancelled the save dialog
    if(saveId === undefined) {
      return;
    }

    const blob = await fetch(url).then((response) => response.blob());
    for(let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
      const chunk = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
      // * one chunk at a time, which keeps their order
      await invoke('write_file_chunk', chunk, {headers: {[SAVE_ID_HEADER]: String(saveId)}});
    }

    const saved = await invoke<SavedFileInfo>('finish_file_save', {id: saveId});
    showSavedToast(saved, key);
  } catch(err) {
    if(saveId !== undefined) {
      invoke('abort_file_save', {id: saveId}).catch(noop);
    }

    console.error('Failed to save a file', err);
    toastNew({langPackKey: 'Signal.Desktop.SaveFailed'});
  }
}

function showSavedToast({fileName, folderName}: SavedFileInfo, key: string) {
  const content = document.createElement('span');
  const open = anchorCallback(() => runFileAction('open_saved_file', key));
  open.append(i18n('Open'));
  const reveal = anchorCallback(() => runFileAction('reveal_saved_file', key));
  reveal.append(i18n(getShowInFolderLangKey()));
  content.append(i18n('Signal.Desktop.FileSaved', [fileName, folderName]), ' ', open, ' ', reveal);
  toast(content, undefined, SAVED_TOAST_DURATION_MS);
}

async function runFileAction(command: 'open_saved_file' | 'reveal_saved_file', key: string) {
  try {
    // * the app words the confirmation for a dangerous type itself, in the language that this code names
    const args = command === 'open_saved_file' ? {key, langCode: I18n.getLastRequestedLangCode()} : {key};
    const outcome = await invoke<SavedFileOutcome>(command, args);
    if(outcome === 'missing') {
      toastNew({langPackKey: 'Signal.Desktop.FileNotFound'});
    }
  } catch(err) {
    console.error('Failed to open a saved file', err);
    toastNew({langPackKey: 'Signal.Desktop.OpenFailed'});
  }
}

function getShowInFolderLangKey(): LangPackKey {
  if(IS_APPLE) return 'Signal.Desktop.ShowInFinder';
  return IS_WINDOWS ? 'Signal.Desktop.ShowInExplorer' : 'Signal.Desktop.ShowInFolder';
}
