import editableFieldStyles from '@/scss/modulePartials/editableFieldContent.module.scss';
import Button from '@components/buttonTsx';
import attachPlainMessageEditor from '@components/chat/inputEditor/plainField';
import InputField from '@components/inputField';
import Scrollable from '@components/scrollable2';
import Section from '@components/section';
import SimpleFormField from '@components/simpleFormField';
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret';
import {I18nTsx} from '@helpers/solid/i18n';
import classNames from '@helpers/string/classNames';
import I18n from '@lib/langPack';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import type SolidJSHotReloadGuardProvider from '@lib/solidjs/hotReloadGuardProvider';
import {createSignal, onCleanup, Show} from 'solid-js';
import PopupElement, {createPopup, useSnitchedPopupContext} from '../indexTsx';
import {EmojiButtonWithOpacity as EmojiDropdownButton} from './emojiButtonWithOpacity';
import {PollOptionsSectionContent} from './pollOptionsSectionContent';
import {PollSettingsSectionContent} from './pollSettingsSectionContent';
import {
  CreatePollContext,
  CreatePollPayload,
  createPollStoreContextValue,
  SupportedMediaType,
  useCreatePollContext
} from './storeContext';
import styles from './styles.module.scss';
import {useCreatePollLimits} from './useCreatePollLimits';
import {createFormFieldClickHandler, getFinalPayload, hasMeaningfulChanges, interactableClass, useCanSubmit, useVisibleOptionsLeft} from './utils';


type CreatePollPopupProps = {
  isBroadcast?: boolean;
  supportedMediaTypes?: SupportedMediaType[];
  quiz?: boolean;
  onSubmit: (payload: CreatePollPayload) => void;
};

export const CreatePollPopup = (props: CreatePollPopupProps) => {
  const {confirmationPopup} = useHotReloadGuard();

  const context = createPollStoreContextValue({
    isBroadcast: () => props.isBroadcast ?? false,
    supportedMediaTypes: () => props.supportedMediaTypes ?? [],
    quiz: props.quiz
  });

  const {SnitchPopupContext, popupContext} = useSnitchedPopupContext();

  const isConfirmationNeededOnClose = () => {
    if(!hasMeaningfulChanges(context.store)) return false;

    return confirmationPopup({
      titleLangKey: 'CancelPollAlertTitle',
      descriptionLangKey: 'CancelPollAlertText',
      button: {
        langKey: 'Discard',
        isDanger: true
      }
    });
  };

  return (
    <PopupElement
      show
      class={styles.popup}
      containerClass={styles.container}
      isConfirmationNeededOnClose={isConfirmationNeededOnClose}
    >
      <SnitchPopupContext />
      <CreatePollContext.Provider value={context}>
        <Header
          onSubmit={() => {
            props.onSubmit(getFinalPayload(context));
            popupContext()?.destroy();
          }}
        />
        <PopupElement.Body>
          <BodyContent />
        </PopupElement.Body>
      </CreatePollContext.Provider>
    </PopupElement>
  );
};

const Header = (props: {
  onSubmit: () => void;
}) => {
  const canSubmit = useCanSubmit();

  return (
    <PopupElement.Header>
      <PopupElement.CloseButton />

      <PopupElement.Title>
        <I18nTsx key='NewPoll' />
      </PopupElement.Title>

      <Button class={styles.confirmButton} primaryFilled onClick={props.onSubmit} disabled={!canSubmit()}>
        <I18nTsx key='Create' />
      </Button>
    </PopupElement.Header>
  );
};

const QuestionAndDescription = () => {
  const context = useCreatePollContext();
  const {maxQuestionLength} = useCreatePollLimits();

  const questionInput = new InputField({
    canWrapCustomEmojis: true,
    onRawInput: () => {
      const {value, entities} = getRichValueWithCaret(questionInput.input);
      context.setStore({
        question: value,
        questionEntities: entities
      });
    }
  });

  // The question travels as text plus entities and holds one line.
  const questionInputEditor = attachPlainMessageEditor(questionInput.input);
  onCleanup(() => questionInputEditor.destroy());

  questionInput.input.classList.replace('input-field-input', editableFieldStyles.editableFieldContent);
  questionInput.input.setAttribute('aria-label', I18n.format('AskAQuestion', true));

  return (
    <>
      <SimpleFormField
        value={context.store.question}
        class={classNames(styles.flexFull, styles.formField)}
        withEndButtonIcon
        withMinHeight
        onClick={createFormFieldClickHandler(questionInput)}
      >
        <SimpleFormField.InputStub>
          {questionInput.input}
        </SimpleFormField.InputStub>
        <SimpleFormField.Label maxLength={maxQuestionLength()}>
          <I18nTsx key='AskAQuestion' />
        </SimpleFormField.Label>

        <SimpleFormField.SideContent withFixedIcon first last>
          <EmojiDropdownButton class={interactableClass} inputField={questionInput} />
        </SimpleFormField.SideContent>
      </SimpleFormField>

      {/* TeleSignal: a Signal poll has no description */}
    </>
  );
};

const BodyContent = () => {
  const [scrollable, setScrollable] = createSignal<HTMLElement>();
  const visibleOptionsLeft = useVisibleOptionsLeft();

  return (
    <PopupElement.Scrollable ref={setScrollable}>
      <Section>
        <QuestionAndDescription />
      </Section>

      <Section
        name='PollOptions'
        caption={
          <Show when={visibleOptionsLeft() > 0} fallback={<I18nTsx key='NewPoll.MaxOptions' />}>
            <I18nTsx key='NewPoll.OptionsLeft' args={visibleOptionsLeft().toString()} />
          </Show>
        }
      >
        <PollOptionsSectionContent scrollable={scrollable()} />
      </Section>

      <Section name='Settings'>
        <PollSettingsSectionContent />
      </Section>
    </PopupElement.Scrollable>
  );
};

export function openCreatePollPopup(props: CreatePollPopupProps, HotReloadGuard: typeof SolidJSHotReloadGuardProvider) {
  createPopup(() => <HotReloadGuard><CreatePollPopup {...props} /></HotReloadGuard>);
}
