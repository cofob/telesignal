/*
 * TeleSignal: Web A's send arrow (`src/assets/font-icons/new-send.svg`), drawn where Web K's icon font has Telegram's
 * paper plane. It takes the size and the colour of the text around it, as a glyph of the font does.
 */

const SEND_ICON_PATH = 'M16 5.5 6.8 14.7a1.7 1.7 0 0 0 2.4 2.4l5.1-5.1V25a1.7 1.7 0 0 0 3.4 0V12l5.1 5.1a1.7 1.7 0 0 0 2.4-2.4z';
const SVG_NS = 'http://www.w3.org/2000/svg';

export default function createSignalSendIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('signal-send-icon');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SEND_ICON_PATH);
  svg.append(path);
  return svg;
}
