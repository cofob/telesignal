import type {AppNewGroupTab} from '@components/solidJsTabs/tabs';
import {AppAddMembersTab, AppNotificationsTab, AppPrivacyAndSecurityTab, AppUserPermissionsTab} from '@components/solidJsTabs/tabs';


export type ProvidedTabs = {
  AppNotificationsTab: typeof AppNotificationsTab;
  AppAddMembersTab: typeof AppAddMembersTab;
  AppPrivacyAndSecurityTab: typeof AppPrivacyAndSecurityTab;
  AppUserPermissionsTab: typeof AppUserPermissionsTab;

  // Other non solid-js tabs
  AppNewGroupTab: typeof AppNewGroupTab;
};

/**
 * To avoid circular imports, other tabs should be assigned elsewhere in the app (they can be assigned in the module of the tab itself)
 */
export const providedTabs = {
  AppNotificationsTab,
  AppAddMembersTab,
  AppPrivacyAndSecurityTab,
  AppUserPermissionsTab

  // Others to be assigned...
} as ProvidedTabs;
