import {i18n} from '@lib/langPack';
import classNames from '@helpers/string/classNames';
import {formatCountdown} from '@components/popups/myQrCode/link';
import styles from '@components/popups/myQrCode/expiryPill.module.scss';

/**
 * The time left to a temporary code: a text node of its own, the only thing that changes each second. An element, not a
 * component, as an argument of `i18n` takes nodes, and a component may come back as something else (a hot one does).
 */
function time(left: () => number | undefined) {
  return (<span class={styles.time} dir="ltr">{formatCountdown(left() ?? 0)}</span>) as HTMLElement;
}

/** The time left to a contact link, under the card: information only, no tap */
export function ExpiryPill(props: {left: () => number | undefined, top: number, away?: boolean}) {
  return (
    <div class={classNames(styles.place, props.away && styles.away)} style={{top: props.top + 'px'}}>
      <span class={styles.pill}>
        {props.left() === undefined ? i18n('QRCode.CreatingLink') : i18n('QRCode.NoPaid.ExpiresIn', [time(props.left)])}
      </span>
    </div>
  );
}
