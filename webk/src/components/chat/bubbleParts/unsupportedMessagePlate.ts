import {i18n} from '@lib/langPack';

const CLASS_NAME = 'bubble-unsupported';

const ICON_SVG = `<svg class="${CLASS_NAME}-icon" viewBox="0 0 144 144" aria-hidden="true">
  <path class="${CLASS_NAME}-icon-bubble" fill-rule="evenodd" d="M72.5,14C104.81,14 131,40.19 131,72.5C131,104.81 104.81,131 72.5,131C60.92,131 50.12,127.63 41.04,121.83L19.43,129.16C17.14,129.94 14.92,127.81 15.59,125.49L22.22,102.42C17,93.67 14,83.43 14,72.5C14,40.19 40.19,14 72.5,14Z"/>
  <path class="${CLASS_NAME}-icon-plane" transform="translate(40.5 40.5) scale(2)" d="M16 5.5 6.8 14.7a1.7 1.7 0 0 0 2.4 2.4l5.1-5.1V25a1.7 1.7 0 0 0 3.4 0V12l5.1 5.1a1.7 1.7 0 0 0 2.4-2.4z"/>
</svg>`;

/**
 * The plate a message this client cannot show is drawn as, the way Android draws it (`UnsupportedBlockDrawable`), with
 * Web A's send arrow in the bubble (`src/assets/font-icons/new-send.svg`)
 */
export default function wrapUnsupportedMessagePlate() {
  const container = document.createElement('div');
  container.classList.add(CLASS_NAME);
  container.insertAdjacentHTML('beforeend', ICON_SVG);

  const text = document.createElement('div');
  text.classList.add(`${CLASS_NAME}-text`);

  const title = i18n('UnsupportedMessageTitle');
  title.classList.add(`${CLASS_NAME}-title`);

  const subtitle = i18n('UnsupportedMessageMessage');
  subtitle.classList.add(`${CLASS_NAME}-subtitle`);

  text.append(title, subtitle);

  container.append(text);
  return container;
}
