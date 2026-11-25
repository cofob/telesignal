import {createMemo, createSignal, For, onCleanup, Show, JSX} from 'solid-js';
import Row from '@components/rowTsx';
import Section from '@components/section';
import I18n, {i18n, LangPackKey} from '@lib/langPack';
import InlineSelect from '@components/inlineSelect';
import confirmationPopup from '@components/confirmationPopup';
import noop from '@helpers/noop';
import {isSignalPasscodeEnabled} from '@lib/signal/frontend';
import {
  getDefaultKeyboardShortcutCombos,
  getKeyboardShortcutCombos,
  getKeyboardShortcutOverrides,
  getMessageSendKeyCombo,
  listenKeyboardShortcuts,
  resetKeyboardShortcuts,
  setKeyboardShortcut,
  setMessageSendKeyCombo,
  type ResolvedKeyboardShortcutCombo
} from '@lib/keyboardShortcuts';
import {
  buildKeyboardShortcutCombos,
  buildKeyboardShortcutConflicts,
  checkRecordedCombo,
  findEditableDefaultComboOwners,
  type RecordedComboCheck
} from '@lib/keyboardShortcutConflicts';
import {
  KEYBOARD_SHORTCUT_SECTIONS,
  KEYBOARD_SHORTCUTS,
  type KeyboardShortcutId,
  type KeyboardShortcutSection
} from '@signal-app/keyboard-shortcuts';
import {
  getEventModifiers,
  getKeyComboFromEvent,
  getKeyComboLabels,
  getKeyComboText,
  getKeyLabel,
  getModifierLabels,
  type KeyComboModifier,
  type KeyLabelLang
} from '@signal-app/key-combos';
import styles from './keyboardShortcuts.module.scss';

/*
 * TeleSignal: the keyboard shortcuts as Web A's settings show and change them (`SettingsKeyboardShortcuts`): Web A's
 * registry, by section, with the user's own combos, which both frontends share (`lib/keyboardShortcuts`). A click on a
 * shortcut that can be changed records a new combo; Esc cancels and Backspace clears it, a combo that another
 * shortcut has is taken from it after a question, and the context menu puts a changed one back to its default.
 */

// * the shortcuts that Web K handles, by Web A's ids; the others of the registry are features Web K does not have
const WEBK_SHORTCUT_IDS = new Set<KeyboardShortcutId>([
  'globalSearch', 'quickChatPicker', 'savedMessages', 'archivedChats', 'openSettings', 'lockScreen', 'quitApp',
  'closeOrGoBack', 'previousChat', 'nextChat', 'openFolderByNumber', 'searchInChat', 'focusMessageInput',
  'editLastMessage', 'replyToPreviousMessage', 'replyToNextMessage', 'copySelectedMessages', 'deleteSelectedMessages',
  'pauseVoiceRecording', 'bold', 'italic', 'underline', 'strikethrough', 'monospace', 'spoiler', 'link',
  'mediaEditorUndo', 'mediaEditorRedo'
]);
const MODIFIER_NAMES = new Set(['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta']);
const CLEAR_KEYS = new Set(['Backspace', 'Delete']);
const CONDITION_TITLE_KEYS = {
  hasSelection: 'ShortcutWhenSelection',
  noSelection: 'ShortcutWhenNoSelection',
  isInputEmpty: 'ShortcutWhenInputEmpty'
} as const;
const COMMAND_MODIFIERS: KeyComboModifier[] = ['Ctrl', 'Alt', 'Meta'];

const lang = ((key: string) => I18n.format(key as LangPackKey, true)) as KeyLabelLang;
const format = (key: string, args?: string[]) => I18n.format(key as LangPackKey, true, args);

const Keys = (props: {groups: string[][]}) => (
  <span class={styles.keys}>
    <For each={props.groups}>
      {(labels, index) => (
        <>
          <Show when={index() > 0}>
            <span class={styles.or}>/</span>
          </Show>
          <span class={styles.combo}>
            <For each={labels}>{(label) => <span class={styles.kbd}>{label}</span>}</For>
          </span>
        </>
      )}
    </For>
  </span>
);

function getDisplayKeyLabels(displayKeys: string[]) {
  const modifiers = displayKeys.filter((key) => MODIFIER_NAMES.has(key)) as (KeyComboModifier | 'Mod')[];
  const keys = displayKeys.filter((key) => !MODIFIER_NAMES.has(key));
  return [...getModifierLabels(modifiers), ...keys.map((key) => getKeyLabel(key, lang))];
}

const SendShortcutRow = () => {
  const [rowEl, setRowEl] = createSignal<HTMLElement>();
  const [isOpen, setIsOpen] = createSignal(false);

  const options = [
    {value: 'enter' as const, label: () => <Keys groups={[getKeyComboLabels('Enter', lang)]} />},
    {value: 'ctrl-enter' as const, label: () => <Keys groups={[getKeyComboLabels('Mod+Enter', lang)]} />}
  ];

  return (
    <Row ref={setRowEl} clickable={() => setIsOpen(true)}>
      <Row.Title>{i18n('KeyboardShortcuts.Action.Send')}</Row.Title>
      <Row.RightContent>
        <InlineSelect
          value={getMessageSendKeyCombo()}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          options={options}
          onChange={(value) => void setMessageSendKeyCombo(value)}
          parent={rowEl()}
        />
      </Row.RightContent>
    </Row>
  );
};

const PlainRow = (props: {action: LangPackKey, keys: JSX.Element}) => (
  <Row>
    <Row.Title titleRight={props.keys} titleRightSecondary>{i18n(props.action)}</Row.Title>
  </Row>
);

// * the way of sending that both frontends share (`messageSendKeyCombo` of Web A)
const MessagesSection = () => {
  const newLine = () => getMessageSendKeyCombo() === 'ctrl-enter' ? 'Enter' : 'Shift+Enter';

  return (
    <Section name="KeyboardShortcuts.Section.Messages" caption="KeyboardShortcuts.Section.Messages.Caption">
      <SendShortcutRow />
      <PlainRow action="KeyboardShortcuts.Action.NewLine" keys={<Keys groups={[getKeyComboLabels(newLine(), lang)]} />} />
      <PlainRow action="KeyboardShortcuts.Action.JumpToInputStart" keys={<Keys groups={[getKeyComboLabels('Ctrl+PageUp', lang)]} />} />
      <PlainRow action="KeyboardShortcuts.Action.JumpToInputEnd" keys={<Keys groups={[getKeyComboLabels('Ctrl+PageDown', lang)]} />} />
    </Section>
  );
};

// * the viewers keep their own keys, which are not in the shared registry's handling yet
const ViewersSections = () => (
  <>
    <Section name="KeyboardShortcuts.Section.MediaViewer">
      <PlainRow action="KeyboardShortcuts.Action.NextMedia" keys={<Keys groups={[[getKeyLabel(I18n.isRTL() ? 'ArrowLeft' : 'ArrowRight', lang)]]} />} />
      <PlainRow action="KeyboardShortcuts.Action.PreviousMedia" keys={<Keys groups={[[getKeyLabel(I18n.isRTL() ? 'ArrowRight' : 'ArrowLeft', lang)]]} />} />
      <PlainRow action="KeyboardShortcuts.Action.ZoomIn" keys={<Keys groups={[getKeyComboLabels('Mod+=', lang)]} />} />
      <PlainRow action="KeyboardShortcuts.Action.ZoomOut" keys={<Keys groups={[getKeyComboLabels('Mod+-', lang)]} />} />
    </Section>
    <Section name="KeyboardShortcuts.Section.Stories">
      <PlainRow action="KeyboardShortcuts.Action.NextStory" keys={<Keys groups={[[getKeyLabel(I18n.isRTL() ? 'ArrowLeft' : 'ArrowRight', lang)]]} />} />
      <PlainRow action="KeyboardShortcuts.Action.PreviousStory" keys={<Keys groups={[[getKeyLabel(I18n.isRTL() ? 'ArrowRight' : 'ArrowLeft', lang)]]} />} />
      <PlainRow action="KeyboardShortcuts.Action.PlayPauseStory" keys={<Keys groups={[[getKeyLabel('Space', lang)]]} />} />
      <PlainRow action="KeyboardShortcuts.Action.CloseStories" keys={<Keys groups={[[getKeyLabel('ArrowDown', lang)]]} />} />
    </Section>
  </>
);

const KeyboardShortcutsTab = () => {
  listenKeyboardShortcuts();
  const combos = createMemo(() => {
    getKeyboardShortcutOverrides();
    return buildKeyboardShortcutCombos();
  });
  const conflicts = createMemo(() => buildKeyboardShortcutConflicts(combos()));
  const [recordingId, setRecordingId] = createSignal<KeyboardShortcutId>();
  const [recordingModifiers, setRecordingModifiers] = createSignal<KeyComboModifier[]>([]);
  const [recordError, setRecordError] = createSignal<{id: KeyboardShortcutId, text: string}>();

  const isShown = (id: KeyboardShortcutId) => WEBK_SHORTCUT_IDS.has(id) &&
    (KEYBOARD_SHORTCUTS[id].isEditable || getDefaultKeyboardShortcutCombos(id).length > 0);
  const getSectionIds = (section: KeyboardShortcutSection) => (Object.keys(KEYBOARD_SHORTCUTS) as KeyboardShortcutId[])
  .filter((id) => KEYBOARD_SHORTCUTS[id].section === section && isShown(id));

  const stopRecording = () => {
    setRecordingId(undefined);
    setRecordingModifiers([]);
  };

  const record = (id: KeyboardShortcutId, combo: string | false) => {
    const current = combos()[id];
    const isUnchanged = combo === false ? !current.length : current.some((resolved) => resolved.combo === combo);
    if(isUnchanged) return;
    if(combo === false) {
      void setKeyboardShortcut(id, false);
      return;
    }

    const [recorded] = getKeyboardShortcutCombos(id, {[id]: combo});
    const check = checkRecordedCombo(id, recorded, combos());
    if(check.type === 'ok') {
      void setKeyboardShortcut(id, combo);
    } else if(check.type === 'usedByEditable') {
      void replace(id, check.ownerIds, combo);
    } else {
      setRecordError({id, text: getRecordErrorText(check, combo)});
    }
  };

  // * Web A's question before a combo is taken from other shortcuts: they keep another combo of theirs, or none
  const replace = async(id: KeyboardShortcutId, ownerIds: KeyboardShortcutId[], combo?: string) => {
    const keys = combo ? [combo] : getDefaultKeyboardShortcutCombos(id).map((resolved) => resolved.combo)
    .filter((defaultCombo) => ownerIds.some((ownerId) => combos()[ownerId].some((resolved) => resolved.combo === defaultCombo)));
    try {
      await confirmationPopup({
        titleLangKey: 'ShortcutReplaceTitle' as LangPackKey,
        descriptionLangKey: 'ShortcutReplaceText' as LangPackKey,
        descriptionLangArgs: [
          keys.map((key) => getKeyComboText(key, lang)).join(' / '),
          ownerIds.map((ownerId) => format(KEYBOARD_SHORTCUTS[ownerId].titleKey)).join(', ')
        ],
        button: {langKey: 'Replace' as LangPackKey}
      });
    } catch{
      return;
    }

    const taken = combo ? [combo] : getDefaultKeyboardShortcutCombos(id).map((resolved) => resolved.combo);
    for(const ownerId of ownerIds) {
      const ownerCombo = combos()[ownerId].find((resolved) => !taken.includes(resolved.combo))?.combo;
      await setKeyboardShortcut(ownerId, ownerCombo ?? false);
    }

    if(combo) await setKeyboardShortcut(id, combo);
    else await resetKeyboardShortcuts(id);
  };

  const reset = (id: KeyboardShortcutId) => {
    setRecordError(undefined);
    const ownerIds = findEditableDefaultComboOwners(id, getDefaultKeyboardShortcutCombos(id), combos());
    if(ownerIds.length) void replace(id, ownerIds);
    else void resetKeyboardShortcuts(id);
  };

  const resetAll = () => {
    confirmationPopup({
      titleLangKey: 'ShortcutResetAll' as LangPackKey,
      descriptionLangKey: 'ShortcutResetAllText' as LangPackKey,
      button: {langKey: 'ThemeResetToDefaults' as LangPackKey, isDanger: true}
    }).then(() => resetKeyboardShortcuts(), noop);
  };

  function getRecordErrorText(check: RecordedComboCheck, combo: string) {
    switch(check.type) {
      case 'needsModifier':
        return format('ShortcutNeedsModifier', [getModifierLabels(COMMAND_MODIFIERS).join(' / ')]);
      case 'reserved':
        return format('ShortcutReserved', [getKeyComboText(combo, lang)]);
      case 'usedByFixed':
        return format('ShortcutUsedByFixed', [getKeyComboText(combo, lang), format(KEYBOARD_SHORTCUTS[check.ownerId].titleKey)]);
      default:
        return '';
    }
  }

  // * while a shortcut records, every key is the recording's (Web A's `useKeyboardShortcutRecorder`)
  const onKeyDown = (e: KeyboardEvent) => {
    const id = recordingId();
    if(!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(e.repeat || e.isComposing) return;

    const combo = getKeyComboFromEvent(e);
    if(!combo) {
      setRecordingModifiers(getEventModifiers(e));
      return;
    }

    stopRecording();
    if(combo === 'Escape') return;
    record(id, CLEAR_KEYS.has(combo) ? false : combo);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if(!recordingId()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setRecordingModifiers(getEventModifiers(e));
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', stopRecording);
  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', stopRecording);
  });

  const ShortcutRow = (props: {id: KeyboardShortcutId}) => {
    const shortcut = KEYBOARD_SHORTCUTS[props.id];
    const isModified = () => getKeyboardShortcutOverrides()[props.id] !== undefined;
    const resolved = (): ResolvedKeyboardShortcutCombo[] => combos()[props.id];
    const isRecording = () => recordingId() === props.id;

    const keys = () => {
      if(isRecording()) {
        return recordingModifiers().length ?
          <Keys groups={[getModifierLabels(recordingModifiers())]} /> :
          <span class={styles.or}>{format('ShortcutRecording')}</span>;
      }

      if(shortcut.displayKeys && !isModified()) return <Keys groups={[getDisplayKeyLabels(shortcut.displayKeys)]} />;
      if(resolved().length) return <Keys groups={resolved().map(({combo}) => getKeyComboLabels(combo, lang))} />;
      return <span class={styles.or}>{format('ShortcutNotSet')}</span>;
    };

    const description = () => {
      const lines: string[] = [];
      if(shortcut.condition) lines.push(format(CONDITION_TITLE_KEYS[shortcut.condition]));
      if(shortcut.descriptionKey) lines.push(format(shortcut.descriptionKey));
      if(props.id === 'lockScreen' && !isSignalPasscodeEnabled()) lines.push(format('KeyboardShortcuts.Hint.LockPasscodeNotSet'));
      if(isRecording()) lines.push(format('ShortcutRecordingHint'));
      const error = recordError();
      if(error?.id === props.id) lines.push(error.text);
      const conflictIds = conflicts()[props.id];
      if(conflictIds && !isRecording()) {
        lines.push(format('ShortcutAlsoUsedBy', [conflictIds.map((id) => format(KEYBOARD_SHORTCUTS[id].titleKey)).join(', ')]));
      }

      return lines.join('\n');
    };

    return (
      <Row
        clickable={shortcut.isEditable ? () => {
          setRecordError(undefined);
          setRecordingModifiers([]);
          setRecordingId(props.id);
        } : undefined}
        contextMenu={isModified() ? {buttons: [{icon: 'undo', text: 'ThemeResetToDefaults' as LangPackKey, onClick: () => reset(props.id)}]} : undefined}
      >
        <Row.Title titleRight={keys()} titleRightSecondary>{format(shortcut.titleKey)}</Row.Title>
        <Show when={description()}>
          <Row.Subtitle class={styles.description}>{description()}</Row.Subtitle>
        </Show>
      </Row>
    );
  };

  return (
    <>
      <MessagesSection />
      <For each={KEYBOARD_SHORTCUT_SECTIONS.filter(({section}) => getSectionIds(section).length)}>
        {({section, titleKey, descriptionKey}) => (
          <Section name={titleKey as LangPackKey} caption={descriptionKey as LangPackKey}>
            <For each={getSectionIds(section)}>{(id) => <ShortcutRow id={id} />}</For>
          </Section>
        )}
      </For>
      <ViewersSections />
      <Section>
        <Row clickable={resetAll}>
          <Row.Title class="danger">{format('ShortcutResetAll')}</Row.Title>
        </Row>
      </Section>
    </>
  );
};

export default KeyboardShortcutsTab;
