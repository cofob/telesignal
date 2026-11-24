/*
 * TeleSignal: composes a Signal story, as Web A's `StoryComposerModal` does (Signal Desktop `StoryCreator.dom.tsx`):
 * text on a preset background in one of the story fonts, or a photo or video with a caption, sent to My Story, custom
 * distribution lists and groups.
 */

import {createMemo, createSignal, For, onCleanup, onMount, Show, untrack, useContext} from 'solid-js';
import PopupElement, {createPopup, PopupContext} from '@components/popups/indexTsx';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import InputField from '@components/inputField';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {toastNew} from '@components/toast';
import classNames from '@helpers/string/classNames';
import I18n, {i18n} from '@lib/langPack';
import type {SignalStoryDistributionList, SignalTextStoryStyle} from '@lib/signal/storiesApi';
import {
  fetchStoryDistributionLists,
  fetchStoryGroups,
  sendSignalStory,
  SignalStoryGroup
} from '@lib/signal/storySettingsApi';
import {getStoryBackgroundCss, STORY_BACKGROUNDS} from '@signal-app/story-backgrounds';
import styles from '@components/popups/signalStoryComposer.module.scss';

type Mode = 'text' | 'media';

const TEXT_STYLES: SignalTextStoryStyle[] = ['default', 'bold', 'serif', 'script', 'condensed'];
const TEXT_STYLE_CLASSES: Record<SignalTextStoryStyle, string> = {
  default: styles.styleDefault,
  regular: styles.styleDefault,
  bold: styles.styleBold,
  serif: styles.styleSerif,
  script: styles.styleScript,
  condensed: styles.styleCondensed
};
const BACKGROUNDS = STORY_BACKGROUNDS.map(getStoryBackgroundCss);
// * Signal Android `StoryTextPostView`: text stories take up to 700 characters
const MAX_TEXT_LENGTH = 700;
// * Web A's `SUPPORTED_PHOTO_CONTENT_TYPES` and `SUPPORTED_VIDEO_CONTENT_TYPES`
const MEDIA_TYPES = ['image/png', 'image/gif', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];

/** A list's line under its name: who it reaches */
function getListDescription(list: SignalStoryDistributionList) {
  const count = list.memberIds.length;
  if(list.isMyStory) {
    if(list.isBlockList) {
      return count ? i18n('SignalStory.MyStoryExcept', [count]) : i18n('SignalStory.MyStoryAllConnections');
    }

    return i18n('SignalStory.MyStoryOnly', [count]);
  }

  return i18n('SignalStory.ListMembers', [count]);
}

/** The width and height of a photo or video, which the story sends with it */
function measureMedia(file: File, url: string): Promise<{width?: number, height?: number}> {
  return new Promise((resolve) => {
    if(file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.onloadedmetadata = () => resolve({width: video.videoWidth, height: video.videoHeight});
      video.onerror = () => resolve({});
      video.src = url;
    } else {
      const image = new Image();
      image.onload = () => resolve({width: image.naturalWidth, height: image.naturalHeight});
      image.onerror = () => resolve({});
      image.src = url;
    }
  });
}

export default function showSignalStoryComposerPopup() {
  function Inner() {
    const context = useContext(PopupContext);
    const middleware = untrack(() => context.middlewareHelper).get();
    const [mode, setMode] = createSignal<Mode>('text');
    const [text, setText] = createSignal('');
    const [textStyle, setTextStyle] = createSignal<SignalTextStoryStyle>('default');
    const [backgroundIndex, setBackgroundIndex] = createSignal(0);
    const [file, setFile] = createSignal<File>();
    const [fileUrl, setFileUrl] = createSignal<string>();
    const [lists, setLists] = createSignal<SignalStoryDistributionList[]>([]);
    const [groups, setGroups] = createSignal<SignalStoryGroup[]>([]);
    const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
    const [isSending, setIsSending] = createSignal(false);
    let fileInput: HTMLInputElement, sendButton: HTMLButtonElement;

    const captionField = new InputField({label: 'SignalStory.Caption', plainText: true, withLinebreaks: false});

    onMount(async() => {
      context.setBtnConfirmOnEnter(sendButton);
      const [fetchedLists, fetchedGroups] = await Promise.all([fetchStoryDistributionLists(), fetchStoryGroups()]);
      if(!middleware()) return;
      setLists(fetchedLists ?? []);
      setGroups(fetchedGroups);
      // * My Story is picked to begin with, as in Web A's composer
      const myStory = fetchedLists?.find(({isMyStory}) => isMyStory);
      if(myStory) setSelectedIds([myStory.id]);
    });

    onCleanup(() => {
      const url = fileUrl();
      if(url) URL.revokeObjectURL(url);
    });

    const canSend = createMemo(() => !isSending() && !!selectedIds().length && (mode() === 'text' ? !!text().trim() : !!file()));

    const toggleSelected = (id: string, isSelected: boolean) => {
      setSelectedIds((ids) => isSelected ? [...ids.filter((selectedId) => selectedId !== id), id] : ids.filter((selectedId) => selectedId !== id));
    };

    const onFileChange = () => {
      const chosen = fileInput.files?.[0];
      fileInput.value = '';
      if(!chosen) return;
      if(!MEDIA_TYPES.includes(chosen.type)) {
        toastNew({langPackKey: 'SignalStory.MediaUnsupported'});
        return;
      }

      const previous = fileUrl();
      if(previous) URL.revokeObjectURL(previous);
      setFile(chosen);
      setFileUrl(URL.createObjectURL(chosen));
    };

    const send = async() => {
      if(!canSend()) return;
      setIsSending(true);
      const listIds = new Set(lists().map(({id}) => id));
      const isText = mode() === 'text';
      const media = isText ? undefined : file();
      const size = media ? await measureMedia(media, fileUrl()) : {};
      const caption = captionField.value.trim();
      const isSent = await sendSignalStory(isText ? {
        text: text().trim(),
        textStyle: textStyle(),
        backgroundIndex: backgroundIndex()
      } : {
        file: media,
        ...size,
        caption: caption || undefined
      }, selectedIds().filter((id) => listIds.has(id)), selectedIds().filter((id) => !listIds.has(id))).catch((): undefined => undefined);
      toastNew({langPackKey: isSent ? 'SignalStory.Sent' : 'SignalStory.SendFailed'});
      if(!middleware()) return;
      // * the composer stays open until the story went out, so a story that failed can be sent again
      if(isSent) {
        context.hide();
      } else {
        setIsSending(false);
      }
    };

    const TextEditor = () => (
      <>
        <div class={styles.preview} style={{background: BACKGROUNDS[backgroundIndex()]}}>
          <textarea
            class={classNames(styles.textInput, TEXT_STYLE_CLASSES[textStyle()])}
            value={text()}
            maxLength={MAX_TEXT_LENGTH}
            placeholder={i18n('SignalStory.TextPlaceholder').textContent}
            dir="auto"
            onInput={(e) => setText(e.currentTarget.value)}
          />
        </div>
        <div class={styles.swatches}>
          <For each={BACKGROUNDS}>{(background, index) => (
            <button
              type="button"
              class={classNames(styles.swatch, index() === backgroundIndex() && styles.selected)}
              style={{background}}
              aria-label={I18n.format('SignalStory.Background', true, [index() + 1])}
              onClick={() => setBackgroundIndex(index())}
            />
          )}</For>
        </div>
        <div class={styles.fonts}>
          <For each={TEXT_STYLES}>{(style) => (
            <button
              type="button"
              class={classNames(styles.font, TEXT_STYLE_CLASSES[style], style === textStyle() && styles.selected)}
              onClick={() => setTextStyle(style)}
            >
              Aa
            </button>
          )}</For>
        </div>
      </>
    );

    const MediaEditor = () => (
      <>
        <div class={classNames(styles.preview, styles.mediaPreview)} onClick={() => fileInput.click()}>
          <Show when={fileUrl()} fallback={<span class={styles.mediaHint}>{i18n('SignalStory.ChooseMedia')}</span>}>
            {(url) => file()?.type.startsWith('video/') ?
              <video class={styles.media} src={url()} autoplay muted loop playsinline /> :
              <img class={styles.media} src={url()} alt="" draggable={false} />}
          </Show>
        </div>
        <div class={styles.caption}>{captionField.container}</div>
      </>
    );

    return (
      <>
        <PopupElement.Header>
          <PopupElement.CloseButton />
          <PopupElement.Title title="SignalStory.New" />
          <button ref={sendButton} class={classNames('btn-primary btn-color-primary', styles.send)} disabled={!canSend()} onClick={send}>
            {i18n('SignalStory.Send')}
          </button>
        </PopupElement.Header>
        <PopupElement.Scrollable>
          <div class={styles.editor}>
            <div class={styles.modes}>
              <button
                type="button"
                class={classNames(styles.mode, mode() === 'text' && styles.selected)}
                onClick={() => setMode('text')}
              >
                {i18n('SignalStory.ModeText')}
              </button>
              <button
                type="button"
                class={classNames(styles.mode, mode() === 'media' && styles.selected)}
                onClick={() => setMode('media')}
              >
                {i18n('SignalStory.ModeMedia')}
              </button>
            </div>
            <Show when={mode() === 'text'} fallback={<MediaEditor />}>
              <TextEditor />
            </Show>
            <input ref={fileInput} type="file" class="hide" accept={MEDIA_TYPES.join(',')} onChange={onFileChange} />
          </div>
          <Section name="SignalStory.SendTo">
            <For each={lists()}>{(list) => (
              <Row>
                <Row.CheckboxField>
                  <CheckboxFieldTsx
                    checked={selectedIds().includes(list.id)}
                    onChange={(checked) => toggleSelected(list.id, checked)}
                  />
                </Row.CheckboxField>
                <Row.Title>{list.isMyStory ? i18n('SignalStory.MyStory') : list.name}</Row.Title>
                <Row.Subtitle>{getListDescription(list)}</Row.Subtitle>
              </Row>
            )}</For>
            <For each={groups()}>{(group) => (
              <Row>
                <Row.CheckboxField>
                  <CheckboxFieldTsx
                    checked={selectedIds().includes(group.id)}
                    onChange={(checked) => toggleSelected(group.id, checked)}
                  />
                </Row.CheckboxField>
                <Row.Title>{group.title}</Row.Title>
                <Row.Subtitle>{i18n('SignalStory.GroupStory')}</Row.Subtitle>
              </Row>
            )}</For>
          </Section>
        </PopupElement.Scrollable>
      </>
    );
  }

  createPopup(() => (
    <PopupElement class={styles.popup} closable>
      <Inner />
    </PopupElement>
  ));
}
