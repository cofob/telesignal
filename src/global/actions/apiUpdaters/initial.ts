import type {
  ApiUpdateAuthorizationError,
  ApiUpdateAuthorizationState,
  ApiUpdateConnectionState,
  ApiUpdateCurrentUser,
  ApiUpdateServerTimeOffset,
  ApiUpdateSession,
} from '../../../api/types';
import type { RequiredGlobalActions } from '../../index';
import type { ActionReturnType, GlobalState } from '../../types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { retryLocalization } from '../../../util/localization';
import { setServerTimeOffset } from '../../../util/serverTime';
import { hasStoredSession, updateSessionUserId } from '../../../util/sessions';
import {
  addActionHandler, getActions, getGlobal, setGlobal,
} from '../../index';
import { updateUser, updateUserFullInfo } from '../../reducers';
import { updateAuth } from '../../reducers/auth';
import { updateTabState } from '../../reducers/tabs';
import { selectSharedSettings } from '../../selectors/sharedState';

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'updateApiReady':
      onUpdateApiReady(global);
      break;

    case 'updateAuthorizationState':
      onUpdateAuthorizationState(global, update);
      break;

    case 'updateAuthorizationError':
      onUpdateAuthorizationError(global, update);
      break;

    case 'updateConnectionState':
      onUpdateConnectionState(global, actions, update);
      break;

    case 'updateDeviceDeauthorized':
      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        actions.showNotification({
          message: { key: update.reason === 'unlinked' ? 'SignalDeviceUnlinked' : 'SignalDeviceDeregistered' },
          tabId,
        });
      });
      break;

    case 'updateStaleSession':
      // A slot that the app lists as logged in has no account in the engine, such as a copy of another account's
      // slot: logging out removes it from the menu
      if (hasStoredSession()) actions.signOut({ forceInitApi: true });
      break;

    case 'updateSession':
      onUpdateSession(global, actions, update);
      break;

    case 'updateServerTimeOffset':
      onUpdateServerTimeOffset(update);
      break;

    case 'updateCurrentUser':
      onUpdateCurrentUser(global, update);
      break;

    case 'requestReconnectApi':
      global = { ...global, isSynced: false };
      setGlobal(global);

      global = getGlobal();
      onUpdateConnectionState(global, actions, {
        '@type': 'updateConnectionState',
        connectionState: 'connectionStateConnecting',
      });
      actions.initApi();
      break;

    case 'requestSync':
      actions.sync();
      break;

    case 'error': {
      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        if (actions.showDialog) {
          actions.showDialog({ data: { type: 'error', ...update.error }, tabId });
        }
      });

      break;
    }

    case 'updateStorageLocked':
      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        actions.showDialog({ data: { type: 'storageLocked' }, tabId });
      });
      break;

    case 'notSupportedInFrozenAccount': {
      actions.showNotification({
        title: {
          key: 'NotificationTitleNotSupportedInFrozenAccount',
        },
        message: {
          key: 'NotificationMessageNotSupportedInFrozenAccount',
        },
        tabId: getCurrentTabId(),
      });
      break;
    }
  }
});

function onUpdateApiReady<T extends GlobalState>(global: T) {
  void retryLocalization(selectSharedSettings(global).language);
}

function onUpdateAuthorizationState<T extends GlobalState>(global: T, update: ApiUpdateAuthorizationState) {
  const wasAuthReady = global.auth.state === 'authorizationStateReady';
  const authState = update.authorizationState;

  global = updateAuth(global, {
    state: authState,
    isLoading: false,
  });
  setGlobal(global);
  global = getGlobal();

  switch (authState) {
    case 'authorizationStateLoggingOut':
      global = updateAuth(global, {
        isLoggingOut: true,
      });
      setGlobal(global);
      break;
    case 'authorizationStateWaitCode':
      global = updateAuth(global, {
        isCodeViaApp: update.isCodeViaApp,
        codeInfo: update.codeInfo,
      });
      setGlobal(global);
      break;
    case 'authorizationStateWaitQrCode':
      global = updateAuth(global, {
        isLoadingQrCode: false,
        qrCode: update.qrCode,
        historySync: update.historySync,
      });
      setGlobal(global);
      break;
    case 'authorizationStateWaitBackupRestore':
      global = updateAuth(global, { backupRestore: update.backupRestore });
      setGlobal(global);
      break;
    case 'authorizationStateReady': {
      getActions().loadChatThemes();
      if (wasAuthReady) {
        break;
      }

      global = updateAuth(global, {
        isLoggingOut: false,
      });
      // A tab that the other frontend made inactive stays so: that frontend runs the account now
      Object.values(global.byTabId).forEach(({ id: tabId, inactiveReason }) => {
        if (inactiveReason === 'otherClient') return;
        global = updateTabState(global, {
          inactiveReason: undefined,
        }, tabId);
      });
      setGlobal(global);

      break;
    }
  }
}

function onUpdateAuthorizationError<T extends GlobalState>(global: T, update: ApiUpdateAuthorizationError) {
  if (update.errorCode === 'PASSKEY_CREDENTIAL_NOT_FOUND') {
    getActions().showNotification({
      message: update.errorKey,
      tabId: getCurrentTabId(),
    });
    return;
  }

  global = updateAuth(global, {
    errorKey: update.errorKey,
  });
  setGlobal(global);
}

function onUpdateConnectionState<T extends GlobalState>(
  global: T, actions: RequiredGlobalActions, update: ApiUpdateConnectionState,
) {
  const { connectionState } = update;

  if (connectionState === global.connectionState) {
    return;
  }

  global = {
    ...global,
    connectionState,
  };
  setGlobal(global);

  if (connectionState === 'connectionStateBroken') {
    actions.signOut({ forceInitApi: true });
  }
}

function onUpdateSession<T extends GlobalState>(global: T, actions: RequiredGlobalActions, update: ApiUpdateSession) {
  const { sessionData } = update;
  const { rememberMe, state } = global.auth;

  if (!rememberMe || state !== 'authorizationStateReady' || !sessionData) {
    return;
  }

  actions.saveSession({ sessionData });
}

function onUpdateServerTimeOffset(update: ApiUpdateServerTimeOffset) {
  setServerTimeOffset(update.serverTimeOffset);
}

function onUpdateCurrentUser<T extends GlobalState>(global: T, update: ApiUpdateCurrentUser) {
  const { currentUser, currentUserFullInfo } = update;

  global = {
    ...updateUser(global, currentUser.id, currentUser),
    currentUserId: currentUser.id,
  };
  global = updateUserFullInfo(global, currentUser.id, currentUserFullInfo);
  setGlobal(global);

  updateSessionUserId(currentUser.id);
}
