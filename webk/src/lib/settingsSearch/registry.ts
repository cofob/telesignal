import {createRoot, createSignal} from 'solid-js';
import generated from './generated';
import {A11Y_ONLY_ENTRIES, DESKTOP_APP_ENTRIES, NON_NAVIGABLE_SECTIONS} from './openers';
import Modes from '@config/modes';
import {getShownKeyboardShortcutSections, WEBK_MESSAGES_SECTION, WEBK_VIEWER_SECTIONS} from '@lib/keyboardShortcuts';
import {KEYBOARD_SHORTCUTS} from '@signal-app/keyboard-shortcuts';
import type {LangPackKey} from '@lib/langPack';
import type {
  GeneratedSettingsEntry,
  GeneratedSettingsLink,
  GeneratedSettingsSearchData,
  GeneratedSettingsSection
} from './types';

export const ROOT_SECTION_ID = 'AppSettingsTab';
const KEYBOARD_SHORTCUTS_SECTION_ID = 'AppKeyboardShortcutsTab';

/**
 * Bumped whenever what is searchable changes — a hot-reloaded index during
 * development, or a new language pack at runtime. Everything derived from the
 * registry (the search index, an open results list) watches this to rebuild.
 */
const [version, setVersion] = createRoot(() => createSignal(0));
export const settingsSearchVersion = version;
export const bumpSettingsSearchVersion = () => setVersion((value) => value + 1);

let allSections = new Map<string, GeneratedSettingsSection>();
let sections = new Map<string, GeneratedSettingsSection>();
let entries: GeneratedSettingsEntry[] = [];
let links: GeneratedSettingsLink[] = [];

const chainOf = (sectionId: string) => {
  const chain: string[] = [];
  for(let current = sectionId; current; current = allSections.get(current)?.parentId) {
    if(chain.includes(current)) break; // a cycle would only come from a bad index
    chain.unshift(current);
  }
  return chain;
};

/** A section is searchable only when every step down to it can actually be opened. */
const isReachable = (sectionId: string) => chainOf(sectionId).every((id) => !NON_NAVIGABLE_SECTIONS.has(id));

const load = (data: GeneratedSettingsSearchData) => {
  allSections = new Map(data.sections.map((section) => [section.id, section]));
  sections = new Map(
    data.sections.filter((section) => isReachable(section.id)).map((section) => [section.id, section])
  );
  // the flags are fixed for the page's life (the URL, the build), so they can be read here
  entries = [...data.entries, ...buildKeyboardShortcutEntries()].filter((entry) => sections.has(entry.sectionId) &&
    (Modes.a11y || !A11Y_ONLY_ENTRIES.has(entry.id)) && DESKTOP_APP_ENTRIES[entry.id] !== false);
  links = data.links.filter((link) => sections.has(link.sectionId));
};

/**
 * The sections and shortcuts of the keyboard shortcuts screen, which it builds from Web A's registry, so the extractor
 * cannot read them from the tab
 */
function buildKeyboardShortcutEntries() {
  const result = new Map<string, GeneratedSettingsEntry>();
  const add = (kind: GeneratedSettingsEntry['kind'], titleLangKey: string) => {
    const id = `${KEYBOARD_SHORTCUTS_SECTION_ID}:${titleLangKey}`;
    if(!result.has(id)) {
      result.set(id, {id, sectionId: KEYBOARD_SHORTCUTS_SECTION_ID, kind, titleLangKey: titleLangKey as LangPackKey});
    }
  };

  for(const {titleKey, ids} of getShownKeyboardShortcutSections()) {
    add('subsection', titleKey);
    for(const id of ids) add('row', KEYBOARD_SHORTCUTS[id].titleKey);
  }

  for(const {titleKey, shortcuts} of [WEBK_MESSAGES_SECTION, ...WEBK_VIEWER_SECTIONS]) {
    add('subsection', titleKey);
    for(const shortcut of shortcuts) add('row', shortcut.titleKey);
  }

  return [...result.values()];
}

load(generated);

if(import.meta.hot) {
  // The index is regenerated from the settings tabs on every edit; pick up the
  // new one in place instead of making the developer reload.
  import.meta.hot.accept('./generated', (newModule) => {
    if(!newModule) return;
    load((newModule as unknown as typeof import('./generated')).default);
    bumpSettingsSearchVersion();
  });
}

export const getSections = () => sections;
export const getEntries = () => entries;
export const getLinks = () => links;
export const getSection = (sectionId: string) => sections.get(sectionId);

/** Section ids from the root down to (and including) `sectionId`. */
export const getSectionChain = (sectionId: string) => chainOf(sectionId).filter((id) => sections.has(id));

/**
 * Titles of the sections a result lives under, root first. `includeSelf` is what
 * a row wants (`Privacy and Security > Blocked Users`); a section result drops
 * its own title, which is already the result's heading.
 */
export const getSectionPathKeys = (sectionId: string, includeSelf = true) => {
  const chain = getSectionChain(sectionId);
  const path = includeSelf ? chain : chain.slice(0, -1);
  return path
  // the search itself lives in Settings — saying so on every result adds nothing
  .filter((id) => id !== ROOT_SECTION_ID)
  .map((id) => sections.get(id).titleLangKey)
  .filter(Boolean);
};

export const getSectionDepth = (sectionId: string) => getSectionChain(sectionId).length;

