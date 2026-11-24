/*
 * TeleSignal: the usernames of Signal. A Signal username is a nickname and a discriminator of two or more digits
 * (`alice.01`, libsignal `rust/usernames/src/username.rs`). A name without the discriminator, such as a Telegram bot's,
 * is not a Signal username, so it is never looked up on the server.
 */

export const SIGNAL_USERNAME_PATTERN = /^[a-z_][a-z0-9_]{2,31}\.\d{2,}$/i;
