import {Chat, User} from '@layer';
import wrapAbbreviation from '@lib/richTextProcessor/wrapAbbreviation';

// * As Web A's `Avatar`: a group shows its title's first letter, a user the first letters of the first two words of
// * the full name (`getFirstLetters`)
const USER_INITIAL_WORDS = 2;

export default function getPeerInitials(peer: Chat | User) {
  if(!peer) {
    return wrapAbbreviation('');
  }

  const title = (peer as Chat.chat).title;
  if(title !== undefined) {
    return wrapAbbreviation(title, true);
  }

  const fullName = [
    (peer as User.user).first_name,
    (peer as User.user).last_name
  ].filter(Boolean).join(' ');
  return wrapAbbreviation(fullName.trim().split(/\s+/).slice(0, USER_INITIAL_WORDS).join(' '));
}
