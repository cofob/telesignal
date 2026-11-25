import type {AnimationItemGroup} from '@components/animationIntersector';
import Button from '@components/buttonTsx';
import attachPlainMessageEditor from '@components/chat/inputEditor/plainField';
import createEmojiDropdownButton from '@components/emojiDropdownButton';
import {EmoticonsDropdown} from '@components/emoticonsDropdown';
import {IconTsx} from '@components/iconTsx';
import InputFieldAnimated from '@components/inputFieldAnimated';
import cloneDOMRect from '@helpers/dom/cloneDOMRect';
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret';
import ListenerSetter from '@helpers/listenerSetter';
import {getOverlayRoot} from '@helpers/appWindow';
import throttle from '@helpers/schedulers/throttle';
import classNames from '@helpers/string/classNames';
import I18n, {LangPackKey} from '@lib/langPack';
import SolidJSHotReloadGuardProvider from '@lib/solidjs/hotReloadGuardProvider';
import {createSignal, onCleanup, untrack} from 'solid-js';
import {Portal} from 'solid-js/web';
import type {AiEditorContext} from '@components/richMessageInput/aiContext';
import {AiEditorButton} from '@components/richMessageInput/aiButton';

type InputFieldMessageProps = {
  placeholder?: LangPackKey,
  name?: string,
  withLinebreaks?: boolean,
  maxLength?: number,
  animationGroup?: AnimationItemGroup,
  listenerSetter?: ListenerSetter,
  onScroll?: () => void,
  onInput?: (hasValue: boolean, length: number) => void,
  draft?: Parameters<InputFieldAnimated['setValueSilently']>[0],
  ref?: (inputField: InputFieldAnimated) => void,
  btnConfirm?: HTMLElement,
  btnProps?: Parameters<typeof Button>[0],
  ai?: AiEditorContext,
  /** The popup sends on the send shortcut (`confirmShortcutIsSendShortcut`), so it breaks no line here. */
  sendOnShortcut?: boolean,
};

const InputFieldMessage = (props: InputFieldMessageProps) => {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const [inputFieldContainer, setInputFieldContainer] = createSignal<HTMLDivElement>();

  const inputField = new InputFieldAnimated({
    placeholder: props.placeholder ?? 'PreviewSender.CaptionPlaceholder',
    name: props.name ?? 'message',
    withLinebreaks: props.withLinebreaks ?? true,
    maxLength: props.maxLength
  });

  const additionalClass = 'simple-message-input';
  let btnConfirm = untrack(() => props.btnConfirm);

  {
    const _additionalClass = additionalClass + '-confirm';
    const contentClass = _additionalClass + '-content';
    const inner = () => <IconTsx icon="logo" class={_additionalClass + '-icon icon-mirror'} />;

    if(btnConfirm) {
      btnConfirm.classList.add(_additionalClass);
      if(!btnConfirm.hasAttribute('aria-label')) btnConfirm.setAttribute('aria-label', I18n.format('Send', true));

      <Portal
        mount={btnConfirm}
        ref={(el) => el.classList.add(contentClass)}
      >
        {inner()}
      </Portal>;
    } else {
      <Button
        {...(props.btnProps || {})}
        aria-label={props.btnProps?.['aria-label'] || I18n.format('Send', true)}
        ref={(ref) => {
          btnConfirm = ref;
          (props.btnProps?.ref as any)(ref);
        }}
        primaryFilled
        class={classNames(_additionalClass, props.btnProps.class)}
        noRipple
      >
        <div class={contentClass}>
          {inner()}
        </div>
      </Button>;
    }
  }

  if(props.animationGroup) {
    inputField.input.dataset.animationGroup = props.animationGroup;
  }

  inputField.input.classList.replace('input-field-input', 'input-message-input');
  inputField.input.classList.add(additionalClass + '-input');

  inputField.placeholder.classList.add(
    'input-message-placeholder',
    additionalClass + '-placeholder'
  );
  inputField.label?.classList.add(additionalClass + '-limit');

  // A caption or a forward comment travels as text plus entities.
  const editor = attachPlainMessageEditor(inputField.input, {leaveSendShortcut: props.sendOnShortcut});

  if(props.listenerSetter) {
    if(props.onScroll) {
      props.listenerSetter.add(inputField.input)('scroll', props.onScroll);
    }

    if(props.onInput) {
      props.listenerSetter.add(inputField.input)('input', throttle(() => {
        const {value} = getRichValueWithCaret(inputField.input);
        const trimmed = value.trim();
        props.onInput(!!trimmed, trimmed ? value.length : 0);
      }, 120, true));
    }
  }

  if(props.draft !== undefined) {
    inputField.setValueSilently(props.draft);
  }

  let emoticonsDropdown: EmoticonsDropdown;
  const {button: emojiButton, dispose} = createEmojiDropdownButton({
    inputField,
    class: additionalClass + '-emoji',
    animationGroup: props.animationGroup,
    customParentElement: getOverlayRoot,
    onEmoticonsDropdown: (dropdown) => {
      emoticonsDropdown = dropdown;
      // * the bottom corner on the emoji button's side
      emoticonsDropdown.getElement().style.transformOrigin = 'var(--transform-origin-inline-start) 100%';
    },
    getOpenPosition: () => {
      if(!container()) return {top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0};
      const rect = container().getBoundingClientRect();
      const cloned = cloneDOMRect(rect);
      cloned.left = rect.left;
      cloned.top = rect.top - 420 - 8;
      return cloned;
    }
  });

  onCleanup(() => {
    dispose();
    editor.destroy();
    inputField.destroy();
  });

  props.ref?.(inputField);

  return (
    <div
      ref={setContainer}
      class={additionalClass + '-container'}
    >
      {emojiButton}
      <div ref={setInputFieldContainer} class={classNames('input-message-container', additionalClass + '-inputs')}>
        {inputField.heightWrapper}
        {inputField.placeholder}
      </div>
      {inputField.label}
      {btnConfirm}
      {props.ai && (
        <SolidJSHotReloadGuardProvider>
          <AiEditorButton
            class='simple-message-input-ai-button'
            context={props.ai}
            container={inputFieldContainer()}
            appendTo={container()}
            canSend={false}
            inputField={inputField}
            onApply={(text) => inputField.setValueSilently(text)}
          />
        </SolidJSHotReloadGuardProvider>
      )}
    </div>
  );
};

export default InputFieldMessage;
