import {LangPackKey, i18n} from '@lib/langPack';
import classNames from '@helpers/string/classNames';

export function DelimiterWithText(props: {
  langKey: LangPackKey,
  class?: string,
  /** For a caller that dresses the label itself */
  textClass?: string
}) {
  return (
    <span class={classNames('delimiter-with-text', props.class)}>
      <span class="delimiter-with-text-stripe" />
      <span class={props.textClass}>{i18n(props.langKey)}</span>
      <span class="delimiter-with-text-stripe" />
    </span>
  );
}
