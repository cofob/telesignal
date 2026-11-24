/*
 * TeleSignal: one Signal engine per account slot, as in Web A. The engine of the provider takes its slot from the
 * name of the worker it runs in (`ACCOUNT_SLOT` in `src/util/multiaccount.ts`), so a tab of slot N connects to a worker
 * of its own, named `account=N`, which runs that slot's engine. The worker of the first slot keeps the empty name.
 */

import {CURRENT_ACCOUNT_QUERY_PARAM} from '@lib/accounts/constants';
import {ActiveAccountNumber} from '@lib/accounts/types';

/** The name of the worker that runs the engine of `accountNumber` */
export function getSignalWorkerName(accountNumber: ActiveAccountNumber) {
  return accountNumber === 1 ? '' : `${CURRENT_ACCOUNT_QUERY_PARAM}=${accountNumber}`;
}

/** The slot whose engine this worker runs */
export function getSignalWorkerAccountNumber(): ActiveAccountNumber {
  const accountNumber = Number(new URLSearchParams(self.name).get(CURRENT_ACCOUNT_QUERY_PARAM));
  return accountNumber > 1 ? accountNumber as ActiveAccountNumber : 1;
}
