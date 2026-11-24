/*
 * TeleSignal: the stories settings of Signal, as Web A's `SettingsStories` has them (Signal Android
 * `StorySettingsFragment`): stories on or off, view receipts, who sees My Story and whether they may reply, and custom
 * distribution lists. Every change goes to the storage service.
 */

import {Component, createMemo, createSignal, For, onMount, Show} from 'solid-js';
import {ButtonIconTsx} from '@components/buttonIconTsx';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import InputField from '@components/inputField';
import RadioFormTsx from '@components/radioFormTsx';
import pickSignalStoryPeople from '@components/signalStoryPeople';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {type AppSignalStoriesTab} from '@components/solidJsTabs/tabs';
import I18n, {LangPackKey} from '@lib/langPack';
import type {SignalStoryDistributionList} from '@lib/signal/storiesApi';
import {fetchStorySettings, SignalStorySettings, updateStorySettings} from '@lib/signal/settingsApi';
import {
  deleteStoryDistributionList,
  fetchStoryDistributionLists,
  saveStoryDistributionList
} from '@lib/signal/storySettingsApi';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';

type MyStoryAudience = 'all' | 'except' | 'only';

const SignalStories: Component = () => {
  const [tab] = useSuperTab<typeof AppSignalStoriesTab>();
  const {Row, i18n, confirmationPopup, toastNew} = useHotReloadGuard();

  const [settings, setSettings] = createSignal<SignalStorySettings>();
  const [lists, setLists] = createSignal<SignalStoryDistributionList[]>([]);

  const myStory = createMemo(() => lists().find(({isMyStory}) => isMyStory));
  const customLists = createMemo(() => lists().filter(({isMyStory}) => !isMyStory));
  const audience = createMemo((): MyStoryAudience | undefined => {
    const list = myStory();
    if(!list) return undefined;
    return !list.isBlockList ? 'only' : (list.memberIds.length ? 'except' : 'all');
  });

  onMount(async() => {
    const [fetchedSettings, fetchedLists] = await Promise.all([fetchStorySettings(), fetchStoryDistributionLists()]);
    setSettings(fetchedSettings);
    setLists(fetchedLists ?? []);
  });

  // * the change shows at once and goes back when it fails, as in Web A
  const onSettingsChange = async(update: SignalStorySettings) => {
    const previous = settings();
    setSettings({...previous, ...update});
    const updated = await updateStorySettings(update);
    if(!updated) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      setSettings({...previous});
      return;
    }

    setSettings(updated);
  };

  const saveList = async(list: Omit<SignalStoryDistributionList, 'id'> & {id?: string}) => {
    const saved = await saveStoryDistributionList(list).catch((): undefined => undefined);
    if(!saved) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      return;
    }

    setLists((lists) => lists.some(({id}) => id === saved.id) ?
      lists.map((list) => list.id === saved.id ? saved : list) :
      [...lists, saved]);
  };

  const pickPeople = (title: LangPackKey, memberIds: string[], onPicked: (memberIds: string[]) => void) => {
    pickSignalStoryPeople(tab.slider, title, memberIds, onPicked);
  };

  // * switching between excluding and allowing people starts with nobody picked
  const chooseAudiencePeople = (value: Exclude<MyStoryAudience, 'all'>) => {
    const list = myStory();
    const isBlockList = value === 'except';
    pickPeople('SignalStory.MyStory', list.isBlockList === isBlockList ? list.memberIds : [], (memberIds) => {
      saveList({...myStory(), isBlockList, memberIds});
    });
  };

  // * the radios show the saved audience: a choice shows once it is saved, and one whose people picker was closed, or
  // * whose save failed, goes back (the form is drawn anew, as a radio keeps its own checked state)
  const [audienceFormKey, setAudienceFormKey] = createSignal(0);
  const resetAudienceForm = () => setAudienceFormKey((key) => key + 1);

  const onAudienceChange = async(value: MyStoryAudience) => {
    if(value === 'all') {
      await saveList({...myStory(), isBlockList: true, memberIds: []});
    } else {
      chooseAudiencePeople(value);
    }

    resetAudienceForm();
  };

  const createList = () => {
    const nameField = new InputField({label: 'SignalStories.CustomListName', plainText: true, required: true, withLinebreaks: false});
    confirmationPopup({
      titleLangKey: 'SignalStories.NewList',
      inputField: nameField,
      button: {
        langKey: 'Next',
        callback: () => {
          const name = nameField.value.trim();
          if(!name) return false;
          pickPeople('SignalStories.CustomList', [], (memberIds) => {
            saveList({name, memberIds, areRepliesAllowed: true, isBlockList: false});
          });
        }
      }
    }).catch(() => {});
  };

  const editList = (list: SignalStoryDistributionList) => {
    pickPeople('SignalStories.CustomList', list.memberIds, (memberIds) => saveList({...list, memberIds}));
  };

  const deleteList = (list: SignalStoryDistributionList) => {
    confirmationPopup({
      titleLangKey: 'SignalStories.DeleteList',
      descriptionLangKey: 'SignalStories.DeleteListInfo',
      descriptionLangArgs: [list.name],
      button: {
        langKey: 'Delete',
        isDanger: true,
        callback: async() => {
          if(!await deleteStoryDistributionList(list.id).catch((): undefined => undefined)) {
            toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
            return;
          }

          setLists((lists) => lists.filter(({id}) => id !== list.id));
        }
      }
    }).catch(() => {});
  };

  const countLabel = () => i18n('SignalStory.ListMembers', [myStory()?.memberIds.length ?? 0]);

  return (
    <>
      <Show when={settings()}>
        {(settings) => (
          <Section>
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={!settings().areStoriesDisabled}
                  onChange={(value) => onSettingsChange({areStoriesDisabled: !value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('StoriesSettingEnable')}</Row.Title>
              <Row.Subtitle>{i18n('StoriesSettingEnableInfo')}</Row.Subtitle>
            </Row>
            <Show when={!settings().areStoriesDisabled}>
              <Row>
                <Row.CheckboxFieldToggle>
                  <CheckboxFieldTsx
                    checked={!!settings().areViewReceiptsEnabled}
                    onChange={(value) => onSettingsChange({areViewReceiptsEnabled: value})}
                    toggle
                  />
                </Row.CheckboxFieldToggle>
                <Row.Title>{i18n('StoriesSettingViewReceipts')}</Row.Title>
                <Row.Subtitle>{i18n('StoriesSettingViewReceiptsInfo')}</Row.Subtitle>
              </Row>
            </Show>
          </Section>
        )}
      </Show>

      <Show when={settings() && !settings().areStoriesDisabled && myStory()}>
        <Section name="SignalStory.MyStory" caption="SignalStories.MyStoryInfo">
          <Show keyed when={audienceFormKey() + 1}>
            <RadioFormTsx<MyStoryAudience>
              selected={audience()}
              onChange={onAudienceChange}
              values={[
                {value: 'all', langPackKey: 'SignalStory.MyStoryAllConnections'},
                {value: 'except', langPackKey: 'SignalStories.AllExcept', subtitle: audience() === 'except' ? countLabel() : undefined},
                {value: 'only', langPackKey: 'SignalStories.OnlyShare', subtitle: audience() === 'only' ? countLabel() : undefined}
              ]}
            />
          </Show>
          <Show when={audience() !== 'all'}>
            <Row clickable={() => chooseAudiencePeople(audience() as Exclude<MyStoryAudience, 'all'>)}>
              <Row.Icon icon="user" />
              <Row.Title>{i18n('SignalStories.ChoosePeople')}</Row.Title>
            </Row>
          </Show>
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                checked={myStory().areRepliesAllowed}
                onChange={(value) => saveList({...myStory(), areRepliesAllowed: value})}
                toggle
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('SignalStories.AllowReplies')}</Row.Title>
          </Row>
        </Section>

        <Section name="SignalStories.CustomLists">
          <For each={customLists()}>{(list) => (
            <Row clickable={() => editList(list)}>
              <Row.Icon icon="group" />
              <Row.Title>{list.name}</Row.Title>
              <Row.Subtitle>{i18n('SignalStory.ListMembers', [list.memberIds.length])}</Row.Subtitle>
              <Row.RightContent>
                <ButtonIconTsx
                  icon="delete"
                  aria-label={I18n.format('Delete', true)}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteList(list);
                  }}
                />
              </Row.RightContent>
            </Row>
          )}</For>
          <Row clickable={createList}>
            <Row.Icon icon="add" />
            <Row.Title>{i18n('SignalStories.NewList')}</Row.Title>
          </Row>
        </Section>
      </Show>
    </>
  );
};

export default SignalStories;
