import {createResource, createSignal, For, Show, JSX} from 'solid-js';
import Row from '@components/rowTsx';
import Section from '@components/section';
import I18n, {i18n, LangPackKey} from '@lib/langPack';
import {IS_APPLE} from '@environment/userAgent';
import {useAppSettings} from '@stores/appSettings';
import InlineSelect from '@components/inlineSelect';
import {isSignalPasscodeEnabled} from '@lib/signal/frontend';
import {getLockScreenCombos} from '@appManagers/utils/useLockScreenShortcut';
import styles from './keyboardShortcuts.module.scss';


const KEY_LABELS: {[k: string]: {mac: string, pc: string}} = {
  ctrl: {mac: '⌘', pc: 'Ctrl'},
  // * the Control key itself, which a Mac does not turn into Command
  control: {mac: '⌃', pc: 'Ctrl'},
  shift: {mac: '⇧', pc: 'Shift'},
  alt: {mac: '⌥', pc: 'Alt'},
  meta: {mac: '⌘', pc: 'Win'},
  enter: {mac: '↵', pc: 'Enter'},
  esc: {mac: 'Esc', pc: 'Esc'},
  space: {mac: 'Space', pc: 'Space'},
  up: {mac: '↑', pc: '↑'},
  down: {mac: '↓', pc: '↓'},
  left: {mac: '←', pc: '←'},
  right: {mac: '→', pc: '→'},
  plus: {mac: '+', pc: '+'},
  minus: {mac: '−', pc: '−'}
};

// * keys along the line: the arrow toward its end goes on, the left one in a right-to-left layout
const INLINE_KEYS: {[k: string]: () => string} = {
  next: () => I18n.isRTL() ? 'left' : 'right',
  previous: () => I18n.isRTL() ? 'right' : 'left'
};

function labelFor(key: string): string {
  const lower = INLINE_KEYS[key]?.() ?? key.toLowerCase();
  const lookup = KEY_LABELS[lower];
  if(lookup) return IS_APPLE ? lookup.mac : lookup.pc;
  return key.length === 1 ? key.toUpperCase() : key;
}

const Kbd = (props: {children: JSX.Element}) => (
  <span class={styles.kbd}>{props.children}</span>
);

const KeyCombo = (props: {keys: string[]}) => (
  <span class={styles.keys}>
    <For each={props.keys}>
      {(key, index) => (
        <>
          <Show when={index() > 0}>
            <span class={styles.plus}>+</span>
          </Show>
          <Kbd>{labelFor(key)}</Kbd>
        </>
      )}
    </For>
  </span>
);

const KeyAlternatives = (props: {combos: string[][]}) => (
  <span class={styles.keys}>
    <For each={props.combos}>
      {(combo, index) => (
        <>
          <Show when={index() > 0}>
            <span class={styles.or}>/</span>
          </Show>
          <KeyCombo keys={combo} />
        </>
      )}
    </For>
  </span>
);

const ShortcutRow = (props: {action: LangPackKey, hint?: LangPackKey, keys: JSX.Element}) => (
  <Row>
    <Row.Title titleRight={props.keys} titleRightSecondary>
      {i18n(props.action)}
    </Row.Title>
    <Show when={props.hint}>
      <Row.Subtitle>{i18n(props.hint)}</Row.Subtitle>
    </Show>
  </Row>
);

const FormattingSection = () => (
  <Section
    name="KeyboardShortcuts.Section.Formatting"
    caption="KeyboardShortcuts.Section.Formatting.Caption"
  >
    <ShortcutRow action="KeyboardShortcuts.Action.Bold" keys={<KeyCombo keys={['ctrl', 'B']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Italic" keys={<KeyCombo keys={['ctrl', 'I']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Underline" keys={<KeyCombo keys={['ctrl', 'U']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Strikethrough" keys={<KeyCombo keys={['ctrl', 'S']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Monospace" keys={<KeyCombo keys={IS_APPLE ? ['ctrl', 'shift', 'M'] : ['ctrl', 'M']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Spoiler" keys={<KeyCombo keys={['ctrl', 'P']} />} />
    <ShortcutRow action="KeyboardShortcuts.Action.Link" keys={<KeyCombo keys={['ctrl', 'K']} />} />
  </Section>
);

const SendShortcutRow = () => {
  const [appSettings, setAppSettings] = useAppSettings();
  const [rowEl, setRowEl] = createSignal<HTMLElement>();
  const [isOpen, setIsOpen] = createSignal(false);

  const enterLabel = () => <KeyCombo keys={['enter']} />;
  const ctrlEnterLabel = () => <KeyCombo keys={['ctrl', 'enter']} />;

  const options = [
    {value: 'enter' as const, label: enterLabel},
    {value: 'ctrlEnter' as const, label: ctrlEnterLabel}
  ];

  return (
    <Row ref={setRowEl} clickable={() => setIsOpen(true)}>
      <Row.Title>{i18n('KeyboardShortcuts.Action.Send')}</Row.Title>
      <Row.RightContent>
        <InlineSelect
          value={appSettings.sendShortcut || 'enter'}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          options={options}
          onChange={(value) => setAppSettings('sendShortcut', value)}
          parent={rowEl()}
        />
      </Row.RightContent>
    </Row>
  );
};

const NewLineRow = () => {
  const [appSettings] = useAppSettings();
  const keys = () => appSettings.sendShortcut === 'ctrlEnter' ? ['enter'] : ['shift', 'enter'];

  return (
    <Row>
      <Row.Title titleRight={<KeyCombo keys={keys()} />} titleRightSecondary>
        {i18n('KeyboardShortcuts.Action.NewLine')}
      </Row.Title>
    </Row>
  );
};

const MessagesSection = () => (
  <Section
    name="KeyboardShortcuts.Section.Messages"
    caption="KeyboardShortcuts.Section.Messages.Caption"
  >
    <SendShortcutRow />
    <NewLineRow />
    <ShortcutRow
      action="KeyboardShortcuts.Action.JumpToInputStart"
      keys={<KeyCombo keys={['ctrl', 'PageUp']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.JumpToInputEnd"
      keys={<KeyCombo keys={['ctrl', 'PageDown']} />}
    />
  </Section>
);

const ChatSection = () => (
  <Section name="KeyboardShortcuts.Section.Chat">
    <ShortcutRow
      action="KeyboardShortcuts.Action.EditLast"
      hint="KeyboardShortcuts.Hint.WhenInputEmpty"
      keys={<KeyCombo keys={['up']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ReplyToPrevious"
      keys={<KeyCombo keys={['ctrl', 'up']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ReplyToNext"
      keys={<KeyCombo keys={['ctrl', 'down']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.FocusInput"
      keys={<KeyCombo keys={['Tab']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PauseRecording"
      keys={<KeyCombo keys={['space']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.CopySelected"
      keys={<KeyCombo keys={['ctrl', 'C']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.DeleteSelected"
      keys={<KeyCombo keys={['Delete']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.NextChat"
      keys={<KeyCombo keys={['alt', 'down']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PreviousChat"
      keys={<KeyCombo keys={['alt', 'up']} />}
    />
  </Section>
);

const NavigationSection = () => (
  <Section name="KeyboardShortcuts.Section.Navigation">
    <ShortcutRow
      action="KeyboardShortcuts.Action.OpenSearch"
      keys={<KeyCombo keys={['ctrl', 'F']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.QuickChatPicker"
      keys={<KeyCombo keys={['ctrl', 'K']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.SavedMessages"
      keys={<KeyCombo keys={['ctrl', '0']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.FolderByNumber"
      keys={<KeyCombo keys={['control', 'shift', '1–9']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ClosePopup"
      keys={<KeyCombo keys={['esc']} />}
    />
  </Section>
);

const MediaViewerSection = () => (
  <Section name="KeyboardShortcuts.Section.MediaViewer">
    <ShortcutRow
      action="KeyboardShortcuts.Action.NextMedia"
      keys={<KeyCombo keys={['next']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PreviousMedia"
      keys={<KeyCombo keys={['previous']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ZoomIn"
      keys={<KeyCombo keys={['ctrl', 'plus']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.ZoomOut"
      keys={<KeyCombo keys={['ctrl', 'minus']} />}
    />
  </Section>
);

const StoriesSection = () => (
  <Section name="KeyboardShortcuts.Section.Stories">
    <ShortcutRow
      action="KeyboardShortcuts.Action.NextStory"
      keys={<KeyCombo keys={['next']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PreviousStory"
      keys={<KeyCombo keys={['previous']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.PlayPauseStory"
      keys={<KeyCombo keys={['space']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.CloseStories"
      keys={<KeyCombo keys={['down']} />}
    />
  </Section>
);

const MediaEditorSection = () => (
  <Section name="KeyboardShortcuts.Section.MediaEditor">
    <ShortcutRow
      action="KeyboardShortcuts.Action.Undo"
      keys={<KeyCombo keys={['ctrl', 'Z']} />}
    />
    <ShortcutRow
      action="KeyboardShortcuts.Action.Redo"
      keys={<KeyAlternatives combos={[['ctrl', 'shift', 'Z'], ['ctrl', 'Y']]} />}
    />
  </Section>
);

// * the lock of Web A's passcode, which is set in the A version (`useLockScreenShortcut`)
// * the lock of Web A's passcode, with Web A's combos (`useLockScreenShortcut`); the passcode is set in the A version
const OtherSection = () => {
  const [combos] = createResource(getLockScreenCombos);
  // * as the keys of this tab are written: Ctrl shows as ⌘ on Apple's systems, so a combo there may show twice
  const keys = () => {
    const shown = (combos() || []).map((combo) => combo.split('+').map((key) => key.length > 1 ? key.toLowerCase() : key.toUpperCase()));
    return shown.filter((combo, index) => shown.findIndex((other) => labelsOf(other) === labelsOf(combo)) === index);
  };

  return (
    <Section name="KeyboardShortcuts.Section.Other">
      <ShortcutRow
        action="KeyboardShortcuts.Action.LockPasscode"
        hint={isSignalPasscodeEnabled() ? undefined : 'KeyboardShortcuts.Hint.LockPasscodeNotSet'}
        keys={
          <Show when={keys().length} fallback={<span class={styles.or}>—</span>}>
            <KeyAlternatives combos={keys()} />
          </Show>
        }
      />
    </Section>
  );
};

function labelsOf(keys: string[]) {
  return keys.map(labelFor).join('+');
}

const KeyboardShortcutsTab = () => (
  <>
    <FormattingSection />
    <MessagesSection />
    <ChatSection />
    <NavigationSection />
    <MediaViewerSection />
    <StoriesSection />
    <MediaEditorSection />
    <OtherSection />
  </>
);

export default KeyboardShortcutsTab;
