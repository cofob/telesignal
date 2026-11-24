import type {AdminLog} from '@appManagers/appChatsManager';
import type {MyMessage} from '@appManagers/appMessagesManager';
import isEphemeralMessage from '@appManagers/utils/messages/isEphemeralMessage';

/**
 * Where a bubble stands in a chat's timeline. The bubbles are kept in arrays sorted by binary search, which
 * needs a total order — so every bubble gets one key, made once, and two keys compare field by field:
 * - the day comes first, because each day is a container of its own on screen;
 * - within a day, messages go by date, as in Web A (`compareRenderedMessages`): Signal adds some messages later
 *   with an earlier date, such as a call of the call history. A send still on its way has no date of the server's
 *   yet and stays below the history;
 * - at one date, messages go by `position`: the message id, and for a send still on its way its temporary
 *   id. Two kinds stand somewhere else, and `BubbleGroups` keeps their place:
 *   - an ephemeral message has a local id above every history id, so it takes the position of the message
 *     it follows and comes right after it;
 *   - a send still on its way moves behind an earlier send that has taken its server id, so it is not left
 *     above it at its temporary id (`BubbleGroups.raiseLaterSends`), and a bubble that comes in after that
 *     goes there at once (`getLateSendPosition`).
 *
 * Choosing the field per pair instead (ids for two history messages, dates once an ephemeral one is
 * involved) is not an order: it lets a < b < c < a, and the binary search then files bubbles anywhere.
 */
export type BubbleTimelineKey = {
  day: number,
  /** the date, or `Infinity` for a send still on its way */
  sortDate: number,
  position: number,
  ephemeral: number,
  date: number,
  order: number,
  mid: number,
  /** a send the server has not confirmed yet; not compared */
  pending: boolean
};

export function isPendingTimelineMessage(message: MyMessage | AdminLog) {
  return message._ !== 'channelAdminLogEvent' && !!message.pending;
}

/**
 * @param day the start of the day the message is shown under
 */
export function makeBubbleTimelineKey(
  message: MyMessage | AdminLog,
  mid: number,
  day: number,
  position: number
): BubbleTimelineKey {
  const pending = isPendingTimelineMessage(message);
  const ephemeral = !pending && isEphemeralMessage(message);
  return {
    day,
    sortDate: pending ? Infinity : message.date,
    position,
    ephemeral: +ephemeral,
    date: message.date,
    order: ephemeral ? message.ephemeral_order || 0 : 0,
    mid,
    pending
  };
}

export function compareBubbleTimelineKeys(key1: BubbleTimelineKey, key2: BubbleTimelineKey) {
  return key1.day - key2.day ||
    compareSortDates(key1.sortDate, key2.sortDate) ||
    key1.position - key2.position ||
    key1.ephemeral - key2.ephemeral ||
    key1.date - key2.date ||
    key1.order - key2.order ||
    key1.mid - key2.mid;
}

// * `Infinity - Infinity` is `NaN`, which a comparator cannot return
function compareSortDates(date1: number, date2: number) {
  return date1 === date2 ? 0 : (date1 < date2 ? -1 : 1);
}
