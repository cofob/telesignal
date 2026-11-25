import type { SendErrorKind } from '../db/MessageDb';

import NetworkError from '../net/NetworkError';

/** The server has no account for the recipient: it was deleted, or its devices expired */
export class UnregisteredUserError extends Error {
  constructor(readonly serviceId: string) {
    super(`${serviceId} is not a registered Signal user`);
  }
}

/** A group that an admin ended takes no messages, reactions, votes or edits (Signal Android `PushGroupSendJob`) */
export class GroupTerminatedError extends Error {
  constructor(readonly groupId: string) {
    super('The group has ended');
  }
}

/** We left the group or were removed from it, so it takes no messages, reactions, votes or edits from us */
export class SelfNotInGroupError extends Error {
  constructor(readonly groupId: string) {
    super('We are not a member of the group');
  }
}

/** The recipient left the group, or was removed from it, before the message was encrypted for them */
export class NotGroupMemberError extends Error {
  constructor(readonly serviceId: string) {
    super(`${serviceId} is not a member of the group`);
  }
}

/** The server answered a send, or a prekey fetch for it, with an error status */
export class SendHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** An attachment could not be uploaded; `cause` is the reason */
export class AttachmentUploadError extends Error {
  constructor(readonly cause: unknown) {
    super('The attachment could not be uploaded');
  }
}

// Payload too large, rate limit challenge and too many requests (Signal Desktop `handleMultipleSendErrors`)
const RATE_LIMIT_STATUSES = new Set([413, 428, 429]);
const HTTP_SERVER_ERROR = 500;
const MAX_LOGGED_MESSAGE_LENGTH = 120;
// UUIDs, which are account ids, and phone numbers
const PRIVATE_DATA_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\+\d{6,}/gi;

/**
 * What the user sees as the reason a send failed. Libsignal rejects a verified contact's new identity key with
 * `UntrustedIdentity` until the user accepts it (Signal Desktop `OutgoingIdentityKeyError`).
 */
export function getSendErrorKind(err: unknown): SendErrorKind {
  if (err instanceof AttachmentUploadError) return getSendErrorKind(err.cause);
  if (err instanceof UnregisteredUserError) return 'unregistered';
  if (err instanceof NetworkError) return 'network';
  if (err instanceof SendHttpError) {
    if (RATE_LIMIT_STATUSES.has(err.status)) return 'rateLimited';
    return err.status >= HTTP_SERVER_ERROR ? 'network' : 'other';
  }
  if ((err as { libsignalName?: string } | undefined)?.libsignalName === 'UntrustedIdentity') {
    return 'identityChanged';
  }
  return 'other';
}

/** The error for a log line, without the account ids and phone numbers its message can carry */
export function describeSendError(err: unknown): string {
  if (err instanceof AttachmentUploadError) return `Attachment upload, ${describeSendError(err.cause)}`;
  const name = err instanceof Error ? err.constructor.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  return `${name}: ${message.replace(PRIVATE_DATA_PATTERN, '<id>').slice(0, MAX_LOGGED_MESSAGE_LENGTH)}`;
}
