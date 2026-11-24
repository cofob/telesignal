import {useAppConfig} from '@stores/appState';
import usePremium from '@stores/premium';
import LIMIT_DEFAULTS from '@config/limitDefaults';

const SIGNAL_POLL_OPTIONS_MAX_COUNT = 10;
const SIGNAL_POLL_QUESTION_MAX_LENGTH = 100;
const SIGNAL_POLL_OPTION_MAX_LENGTH = 100;

export const useCreatePollLimits = () => {
  const appConfig = useAppConfig();
  const isPremium = usePremium();

  return {
    // * TeleSignal: the limits of Signal polls (Signal Desktop `ts/types/Polls.dom.ts`)
    maxOptions: () => SIGNAL_POLL_OPTIONS_MAX_COUNT,
    countriesMax: () => appConfig.poll_countries_max ?? 12,
    closePeriodMax: () => appConfig.poll_close_period_max ?? 2628000, // ~ 1 month
    maxQuestionLength: () => SIGNAL_POLL_QUESTION_MAX_LENGTH,
    maxOptionLength: () => SIGNAL_POLL_OPTION_MAX_LENGTH,
    maxDescriptionLength: () => isPremium() ? appConfig.caption_length_limit_premium ?? 4096 : appConfig.caption_length_limit_default ?? LIMIT_DEFAULTS.caption_length_limit_default,
    maxExplanationLength: () => 200
  };
};
