import { memo } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiUser } from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import type { AnimationLevel, ThemeKey } from '../../../types';

import {
  ANIMATION_LEVEL_MAX,
  ANIMATION_LEVEL_MIN,
  ARCHIVED_FOLDER_ID,
} from '../../../config';
import {
  INITIAL_PERFORMANCE_STATE_MAX,
  INITIAL_PERFORMANCE_STATE_MED,
  INITIAL_PERFORMANCE_STATE_MIN,
} from '../../../global/initialState';
import {
  selectTabState, selectTheme, selectUser,
} from '../../../global/selectors';
import { selectSharedSettings } from '../../../global/selectors/sharedState';
import { IS_MULTIACCOUNT_SUPPORTED } from '../../../util/browser/globalEnvironment';
import { getPromptInstall } from '../../../util/installPrompt';
import { getSystemTheme } from '../../../util/systemTheme';

import { useFolderManagerForUnreadCounters } from '../../../hooks/useFolderManager';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import MenuItem from '../../ui/MenuItem';
import MenuSeparator from '../../ui/MenuSeparator';
import NestedMenuItem from '../../ui/NestedMenuItem';
import Switcher from '../../ui/Switcher';
import Toggle from '../../ui/Toggle';
import AccountMenuItems from './AccountMenuItems';

type OwnProps = {
  onSelectSettings: NoneToVoidFunction;
  onSelectContacts: NoneToVoidFunction;
  onSelectCalls: NoneToVoidFunction;
  onSelectArchived: NoneToVoidFunction;
  onSwitchAccount: (url: string) => void;
  footer?: string;
};

type StateProps = {
  animationLevel: AnimationLevel;
  currentUser?: ApiUser;
  theme: ThemeKey;
  canInstall?: boolean;
  areStoriesDisabled?: boolean;
} & Pick<GlobalState, 'currentUserId' | 'archiveSettings'>;

// The other frontend of the same build, which opens the same account (`webk/`)
const WEB_K_PATH = '../k/';

const LeftSideMenuItems = ({
  currentUserId,
  archiveSettings,
  animationLevel,
  theme,
  canInstall,
  currentUser,
  areStoriesDisabled,
  onSelectArchived,
  onSelectContacts,
  onSelectCalls,
  onSelectSettings,
  onSwitchAccount,
  footer,
}: OwnProps & StateProps) => {
  const {
    openChat,
    setSharedSettingOption,
    updatePerformanceSettings,
    openChatWithInfo,
    openStoryComposer,
  } = getActions();
  const lang = useLang();

  const animationLevelValue = animationLevel !== ANIMATION_LEVEL_MIN
    ? (animationLevel === ANIMATION_LEVEL_MAX ? 'max' : 'mid') : 'min';

  const archivedUnreadChatsCount = useFolderManagerForUnreadCounters()[ARCHIVED_FOLDER_ID]?.chatsCount || 0;

  const handleSelectMyProfile = useLastCallback(() => {
    openChatWithInfo({ id: currentUserId, shouldReplaceHistory: true, isOwnProfile: true });
  });

  const handleSelectSaved = useLastCallback(() => {
    openChat({ id: currentUserId, shouldReplaceHistory: true });
  });

  const handleDarkModeToggle = useLastCallback((e: React.SyntheticEvent<HTMLElement>) => {
    e.stopPropagation();
    const newTheme = theme === 'light' ? 'dark' : 'light';
    const shouldUseSystemTheme = newTheme === getSystemTheme();

    setSharedSettingOption({ theme: newTheme });
    setSharedSettingOption({ shouldUseSystemTheme });
  });

  const handleSwitchToWebK = useLastCallback(() => {
    // The account slot (`?account=N`) stays the same in Web K
    const url = new URL(WEB_K_PATH, window.location.href);
    url.search = window.location.search;
    window.location.href = url.href;
  });

  const handleAnimationLevelChange = useLastCallback((e: React.SyntheticEvent<HTMLElement>) => {
    e.stopPropagation();

    let newLevel = animationLevel + 1;
    if (newLevel > ANIMATION_LEVEL_MAX) {
      newLevel = ANIMATION_LEVEL_MIN;
    }
    const performanceSettings = newLevel === ANIMATION_LEVEL_MIN
      ? INITIAL_PERFORMANCE_STATE_MIN
      : (newLevel === ANIMATION_LEVEL_MAX ? INITIAL_PERFORMANCE_STATE_MAX : INITIAL_PERFORMANCE_STATE_MED);

    setSharedSettingOption({ animationLevel: newLevel as AnimationLevel, wasAnimationLevelSetManually: true });
    updatePerformanceSettings(performanceSettings);
  });

  return (
    <>
      {IS_MULTIACCOUNT_SUPPORTED && currentUser && (
        <>
          <AccountMenuItems
            currentUser={currentUser}
            onSelectCurrent={onSelectSettings}
            onSwitchAccount={onSwitchAccount}
          />
          <MenuSeparator />
        </>
      )}
      <MenuItem
        icon="user"
        onClick={handleSelectMyProfile}
      >
        {lang('MenuMyProfile')}
      </MenuItem>
      <MenuItem
        icon="saved-messages"
        onClick={handleSelectSaved}
      >
        {lang('NoteToSelf')}
      </MenuItem>
      {!areStoriesDisabled && (
        <MenuItem
          icon="play-story"
          onClick={() => openStoryComposer()}
        >
          {lang('StoryNew')}
        </MenuItem>
      )}
      {archiveSettings.isHidden && (
        <MenuItem
          icon="archive"
          onClick={onSelectArchived}
        >
          <span className="menu-item-name">{lang('MenuArchivedChats')}</span>
          {archivedUnreadChatsCount > 0 && (
            <div className="right-badge">{archivedUnreadChatsCount}</div>
          )}
        </MenuItem>
      )}
      <MenuItem
        icon="group"
        onClick={onSelectContacts}
      >
        {lang('MenuContacts')}
      </MenuItem>
      <MenuItem
        icon="phone"
        onClick={onSelectCalls}
      >
        {lang('MenuCalls')}
      </MenuItem>
      <MenuItem
        icon="settings"
        onClick={onSelectSettings}
      >
        {lang('MenuSettings')}
      </MenuItem>
      <NestedMenuItem
        icon="more"
        footer={footer}
        submenu={(
          <>
            <MenuItem
              icon="darkmode"
              onClick={handleDarkModeToggle}
            >
              <span className="menu-item-name">{lang('MenuNightMode')}</span>
              <Switcher
                id="darkmode"
                label={lang(theme === 'dark' ? 'AriaMenuDisableNightMode' : 'AriaMenuEnableNightMode')}
                checked={theme === 'dark'}
                noAnimation
              />
            </MenuItem>
            <MenuItem
              icon="animations"
              onClick={handleAnimationLevelChange}
            >
              <span className="menu-item-name capitalize">{lang('MenuUIFeaturesSwitch')}</span>
              <Toggle value={animationLevelValue} />
            </MenuItem>
            <MenuItem
              icon="device-webk"
              onClick={handleSwitchToWebK}
            >
              {lang('MenuSwitchToK')}
            </MenuItem>
            {canInstall && (
              <MenuItem
                icon="install"
                onClick={getPromptInstall()}
              >
                {lang('MenuInstallApp')}
              </MenuItem>
            )}
          </>
        )}
      >
        {lang('MenuMore')}
      </NestedMenuItem>
    </>
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const tabState = selectTabState(global);
    const {
      currentUserId, archiveSettings,
    } = global;
    const { animationLevel } = selectSharedSettings(global);

    return {
      currentUserId,
      currentUser: selectUser(global, currentUserId!),
      theme: selectTheme(global),
      animationLevel,
      canInstall: Boolean(tabState.canInstall),
      archiveSettings,
      areStoriesDisabled: global.stories.settings?.areStoriesDisabled,
    };
  },
)(LeftSideMenuItems));
