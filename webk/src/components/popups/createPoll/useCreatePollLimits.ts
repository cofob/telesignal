// * TeleSignal: the limits of Signal polls (Signal Desktop `ts/types/Polls.dom.ts`)
const SIGNAL_POLL_OPTIONS_MAX_COUNT = 10;
const SIGNAL_POLL_QUESTION_MAX_LENGTH = 100;
const SIGNAL_POLL_OPTION_MAX_LENGTH = 100;

export const useCreatePollLimits = () => ({
  maxOptions: () => SIGNAL_POLL_OPTIONS_MAX_COUNT,
  maxQuestionLength: () => SIGNAL_POLL_QUESTION_MAX_LENGTH,
  maxOptionLength: () => SIGNAL_POLL_OPTION_MAX_LENGTH
});
