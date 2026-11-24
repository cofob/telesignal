import {toastNew} from '@components/toast';

/**
 * A request that failed, said in the generic error toast - but for one of an account session the tab has left meanwhile,
 * whose session-bound managers drop the answer (`MIDDLEWARE`), or one whose reason was shown already (`handled`, as
 * TeleSignal's group changes are): that says nothing
 */
export default function toastError(err: ApiError, label: string) {
  if(err?.type === 'MIDDLEWARE' || err?.handled) {
    return;
  }

  console.error(label, err);
  toastNew({langPackKey: 'Error.AnError'});
}
