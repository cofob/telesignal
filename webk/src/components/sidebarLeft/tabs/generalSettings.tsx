import {createSignal, For, onCleanup, onMount, Show} from 'solid-js';
import {GrowHeightReveal} from '@helpers/solid/animations';
import Section from '@components/section';
import Row from '@components/rowTsx';
import RangeSettingSelector from '@components/rangeSettingSelector';
import RadioFieldTsx from '@components/radioFieldTsx';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import Modes from '@config/modes';
import {i18n, LangPackKey} from '@lib/langPack';
import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {useAppSettings} from '@stores/appSettings';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {subscribeOn} from '@helpers/solid/subscribeOn';
import IS_GEOLOCATION_SUPPORTED from '@environment/geolocationSupport';
import {StateSettings} from '@config/state';
import {AccentPreset, getAccentPresetsForBase, presetThemeId} from '@config/themePresets';
import Scrollable from '@components/scrollable2';
import themeController from '@helpers/themeController';
import liteMode from '@helpers/liteMode';
import {joinDeepPath} from '@helpers/object/setDeepProperty';
import eachMinute from '@helpers/eachMinute';
import fastSmoothScroll from '@helpers/fastSmoothScroll';
import ChatBackgroundStore from '@lib/chatBackgroundStore';
import appDownloadManager from '@lib/appDownloadManager';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {IS_DESKTOP_APP} from '@lib/signal/desktopApp';
import {DesktopAppSection} from './desktopAppSettings';
import {getShouldReplaceTextShortcuts, setShouldReplaceTextShortcuts} from '@lib/signal/textReplacements';

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — text size, chat background, animations toggle, lite mode entry
// ─────────────────────────────────────────────────────────────────────────────

const SettingsSection = () => {
  const [tab] = useSuperTab();
  const [appSettings, setAppSettings] = useAppSettings();

  return (
    <Section name="Settings">
      <RangeSettingSelector
        textLeft={i18n('TextSize')}
        textRight={(value) => '' + value}
        step={1}
        value={appSettings.messagesTextSize}
        minValue={12}
        maxValue={20}
        onChange={(value) => setAppSettings('messagesTextSize', value)}
      />
      <Row clickable={() => tab.slider.createTab(hotReloadGuard.tabs.AppChatBackgroundTab).open()}>
        <Row.Icon icon="appearance_filled" />
        <Row.Title>{i18n('ChatBackground')}</Row.Title>
      </Row>
      <Show when={Modes.a11y}>
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx stateKey={joinDeepPath('settings', 'increaseContrast')} toggle />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('GeneralSettings.IncreaseContrast')}</Row.Title>
          <Row.Subtitle>{i18n('GeneralSettings.IncreaseContrastInfo')}</Row.Subtitle>
        </Row>
      </Show>
      {/* <Row
        clickable={() => {
          if(liteMode.isEnabled()) {
            toastNew({langPackKey: 'LiteMode.DisableAlert'});
          }
        }}
        disabled={liteMode.isEnabled()}
      >
        <Row.CheckboxField>
          <CheckboxFieldTsx
            checked={!appSettings.liteMode.animations}
            onChange={(value) => setAppSettings('liteMode', 'animations', !value)}
          />
        </Row.CheckboxField>
        <Row.Title>{i18n('EnableAnimations')}</Row.Title>
      </Row> */}
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — color theme picker (horizontal scroller + variant radios)
// ─────────────────────────────────────────────────────────────────────────────

const THEME_VARIANTS: [StateSettings['theme'], LangPackKey][] = [
  ['day', 'ThemeDay'],
  ['night', 'ThemeNight'],
  ['light', 'ThemeLight'],
  ['tinted', 'ThemeTinted'],
  ['system', 'AutoNightSystemDefault']
];

const ThemeSection = () => {
  const stateKey = joinDeepPath('settings', 'theme');

  // Theme variant changes flow through the radio's `stateKey`. Bridge the
  // resulting `settings_updated` to a `theme_change` dispatch (preserved from
  // the legacy tab — this is what reapplies the picked theme everywhere).
  subscribeOn(rootScope)('settings_updated', ({key}) => {
    if(key === stateKey) {
      rootScope.dispatchEvent('theme_change');
    }
  });

  // Accent-color picker is Dark-only: only `baseThemeTinted` has the per-base wallpaper map and
  // surface-derivation formulas wired up (see themeController + themePresets). For day/night/light
  // the picker would render but selections wouldn't visually behave — hide and grow-height-reveal
  // when the user actually lands on Dark.
  const [isDark, setIsDark] = createSignal(themeController.getResolvedThemeName() === 'tinted');
  subscribeOn(rootScope)('theme_changed', () => setIsDark(themeController.getResolvedThemeName() === 'tinted'));

  return (
    <Section name="ColorTheme">
      <form style={{'margin-top': '.5rem'}}>
        {THEME_VARIANTS.map(([value, langKey]) => (
          <Row>
            <Row.RadioField>
              <RadioFieldTsx name="theme" value={value} stateKey={stateKey} />
            </Row.RadioField>
            <Row.Title>{i18n(langKey)}</Row.Title>
          </Row>
        ))}
      </form>
      <GrowHeightReveal when={isDark()} appear={false} class="accent-picker-frame">
        <AccentPickerRow />
      </GrowHeightReveal>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Accent-color picker row — ported from iOS' ThemePickerController. Shows a
// "default" swatch + the per-base presets defined in @config/themePresets.
// Tapping a circle routes through themeController.applyAccentPreset so the
// existing applyNewTheme array-preserving codepath is reused; tapping
// "default" calls resetActiveTheme to restore the bundled SETTINGS_INIT entry
// for the current base (so the user can always get back to factory day/night).
// On tinted ("Dark") we skip the default swatch — the factory entry uses the
// blue base-color preset's values, so the blue circle covers both roles.
// ─────────────────────────────────────────────────────────────────────────────

const hexFromInt = (n: number) => '#' + n.toString(16).padStart(6, '0');

const AccentPickerRow = () => {
  let scrollableEl: HTMLDivElement;

  const computeState = () => {
    const theme = themeController.getTheme();
    const base = themeController.getBaseThemeForName(theme.name);
    const presets = getAccentPresetsForBase(base);
    const isTinted = base === 'baseThemeTinted';
    let activeId = String(theme.id ?? '');
    // Tinted factory state has theme.id === '' but the same accent/bubble values as the blue
    // base preset — surface that to the picker so blue reads as active right after install/reset.
    if(isTinted && activeId === '' && presets.length) {
      activeId = presetThemeId(presets[0]);
    }
    return {presets, activeId, showDefault: !isTinted};
  };

  const [state, setState] = createSignal(computeState());

  // Center the active circle horizontally — mirrors the .themes-container behavior where the
  // active thumbnail is auto-scrolled into view after a theme_changed (see ThemeSection).
  const scrollActiveIntoView = () => {
    const active = scrollableEl?.querySelector<HTMLElement>('.accent-circle--active');
    if(!active) return;
    fastSmoothScroll({
      element: active,
      container: scrollableEl,
      axis: 'x',
      position: 'center'
    });
  };

  subscribeOn(rootScope)('theme_changed', () => {
    setState(computeState());
    queueMicrotask(scrollActiveIntoView);
  });

  const onDefault = () => themeController.resetActiveTheme();
  const onPreset = (preset: AccentPreset) => themeController.applyAccentPreset(preset);

  return (
    <Scrollable axis="x" class="accent-picker" ref={(el) => (scrollableEl = el)}>
      <Show when={state().showDefault}>
        <div
          class="accent-circle accent-circle--default"
          classList={{'accent-circle--active': state().activeId === ''}}
          onClick={onDefault}
          title="Default"
        >
          <div class="accent-circle__inner" />
        </div>
      </Show>
      <For each={state().presets}>{(preset) => {
        const accent = hexFromInt(preset.accent_color);
        const fill1 = hexFromInt(preset.message_colors[0] ?? preset.accent_color);
        const fill2 = preset.message_colors[1] !== undefined ? hexFromInt(preset.message_colors[1]) : fill1;
        return (
          <div
            class="accent-circle"
            classList={{'accent-circle--active': state().activeId === presetThemeId(preset)}}
            style={{
              '--accent-circle-ring': accent,
              '--accent-circle-fill-1': fill1,
              '--accent-circle-fill-2': fill2
            }}
            onClick={() => onPreset(preset)}
          >
            <div class="accent-circle__inner" />
          </div>
        );
      }}</For>
    </Scrollable>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — distance units (geolocation only)
// ─────────────────────────────────────────────────────────────────────────────

const DistanceUnitsSection = () => {
  const stateKey = joinDeepPath('settings', 'distanceUnit');
  const radios: [StateSettings['distanceUnit'], LangPackKey][] = [
    ['kilometers', 'DistanceUnitsKilometers'],
    ['miles', 'DistanceUnitsMiles']
  ];

  return (
    <Section name="DistanceUnitsTitle">
      <form>
        {radios.map(([value, langKey]) => (
          <Row>
            <Row.RadioField>
              <RadioFieldTsx name="distance-unit" value={value} stateKey={stateKey} />
            </Row.RadioField>
            <Row.Title>{i18n(langKey)}</Row.Title>
          </Row>
        ))}
      </form>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — time format (h12 / h23) with a live "current time" subtitle
// ─────────────────────────────────────────────────────────────────────────────

const TimeFormatSection = () => {
  const stateKey = joinDeepPath('settings', 'timeFormat');
  const formats: [StateSettings['timeFormat'], LangPackKey][] = [
    ['h12', 'General.TimeFormat.h12'],
    ['h23', 'General.TimeFormat.h23']
  ];

  const items = formats.map(([format, langKey]) => {
    const [subtitle, setSubtitle] = createSignal<string>('');
    return {format, langKey, subtitle, setSubtitle};
  });

  const updateAll = () => {
    const date = new Date();
    items.forEach(({format, setSubtitle}) => {
      const str = date.toLocaleTimeString('en-us-u-hc-' + format, {
        hour: '2-digit',
        minute: '2-digit'
      });
      setSubtitle(str);
    });
  };

  updateAll();
  const cancel = eachMinute(updateAll);
  onCleanup(cancel);

  return (
    <Section name="General.TimeFormat">
      <form>
        {items.map(({format, langKey, subtitle}) => (
          <Row>
            <Row.RadioField>
              <RadioFieldTsx name="time-format" value={format} stateKey={stateKey} />
            </Row.RadioField>
            <Row.Title>{i18n(langKey)}</Row.Title>
            <Row.Subtitle>{subtitle()}</Row.Subtitle>
          </Row>
        ))}
      </form>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — TeleSignal: the composer's text replacements, as Web A's General settings show them
// ─────────────────────────────────────────────────────────────────────────────

const KeyboardSection = () => {
  return (
    <Section name="Signal.Keyboard">
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={getShouldReplaceTextShortcuts()}
            onChange={(value) => void setShouldReplaceTextShortcuts(value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Signal.TextReplacements')}</Row.Title>
        <Row.Subtitle>{i18n('Signal.TextReplacementsInfo')}</Row.Subtitle>
      </Row>
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab root
// ─────────────────────────────────────────────────────────────────────────────

const GeneralSettings = () => {
  return (
    <>
      <SettingsSection />
      <ThemeSection />
      {IS_GEOLOCATION_SUPPORTED && <DistanceUnitsSection />}
      <TimeFormatSection />
      <KeyboardSection />
      {IS_DESKTOP_APP && <DesktopAppSection />}
    </>
  );
};

export default GeneralSettings;
