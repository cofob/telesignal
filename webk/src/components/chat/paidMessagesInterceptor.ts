import {MOUNT_CLASS_TO} from '@config/debug';

export type ConfirmedPaymentResult = {
  starsAmount: number;
  canUndo: boolean;
};

/**
 * `undefined` if no stars are needed, or a PAYMENT_REJECTED symbol if the user cancels the payment
 */
type PreparedPaymentResult = undefined | typeof PAYMENT_REJECTED | ConfirmedPaymentResult;

const PAYMENT_REJECTED_SYMBOL = Symbol('Payment rejected');
export const PAYMENT_REJECTED: typeof PAYMENT_REJECTED_SYMBOL = PAYMENT_REJECTED_SYMBOL;

/**
 * The step every send goes through before a message is sent. TeleSignal: Signal has no paid messages, so there is
 * never anything to pay, confirm or undo
 */
export default class PaidMessagesInterceptor {
  public static PaymentRejectedSymbol: typeof PAYMENT_REJECTED = PAYMENT_REJECTED;

  public dispose() {}

  public async prepareStarsForPayment(messageCount: number): Promise<PreparedPaymentResult> {
    return undefined;
  }

  /** Static method - to be used outside a chat instance */
  public static async prepareStarsForPayment(args: {messageCount: number, peerId: PeerId}): Promise<PreparedPaymentResult> {
    return undefined;
  }
}

MOUNT_CLASS_TO['PaidMessagesInterceptor'] = PaidMessagesInterceptor;
