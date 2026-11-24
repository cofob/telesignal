use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tauri::{
  AppHandle, Manager, WebviewWindow,
  image::Image,
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};

#[cfg(not(target_os = "macos"))]
mod badge;

pub use crate::{AppState, DEFAULT_WINDOW_TITLE, LAST_URL};

// Platform-specific tray icon assets
#[cfg(target_os = "macos")]
pub(crate) static TRAY_ICON_BYTES: &[u8] = include_bytes!("../../icons/tray-macos.png");

#[cfg(not(target_os = "macos"))]
pub(crate) static TRAY_ICON_BYTES: &[u8] = include_bytes!("../../icons/32x32.png");

pub(crate) static TRAY_BASE_ICON: LazyLock<Image<'static>> =
  LazyLock::new(|| Image::from_bytes(TRAY_ICON_BYTES).expect("Failed to load base tray icon"));

// Menu constants
pub const MENU_ITEM_QUIT_ID: &str = "quit";
pub const MENU_ITEM_QUIT_LABEL: &str = "Quit TeleSignal";
pub const MENU_ITEM_OPEN_ID: &str = "open";
pub const MENU_ITEM_OPEN_LABEL: &str = "Open TeleSignal";

static MENU_TRANSLATIONS: LazyLock<std::sync::Mutex<HashMap<String, String>>> =
  LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

pub(super) static TRAY_HANDLE: LazyLock<Mutex<Option<TrayIcon>>> =
  LazyLock::new(|| Mutex::new(None));

pub fn set_menu_translations(new_labels: HashMap<String, String>) {
  if let Ok(mut labels) = MENU_TRANSLATIONS.lock() {
    *labels = new_labels;
  }
}

pub(crate) fn translated_label(id: &str, default: &str) -> String {
  if let Ok(labels) = MENU_TRANSLATIONS.lock() {
    labels
      .get(id)
      .cloned()
      .unwrap_or_else(|| default.to_string())
  } else {
    default.to_string()
  }
}

#[derive(Default)]
pub struct TrayManager;

/// The tray menu with the labels that the page sent
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let quit_label = translated_label(MENU_ITEM_QUIT_ID, MENU_ITEM_QUIT_LABEL);
  let quit_i = MenuItem::with_id(app, MENU_ITEM_QUIT_ID, &quit_label, true, None::<&str>)?;

  let open_label = translated_label(MENU_ITEM_OPEN_ID, MENU_ITEM_OPEN_LABEL);
  let open_i = MenuItem::with_id(app, MENU_ITEM_OPEN_ID, &open_label, true, None::<&str>)?;

  Menu::with_items(app, &[&open_i, &quit_i])
}

/// Builds the tray menu again with the current labels
pub fn refresh_menu(app: &AppHandle) {
  let Ok(tray_opt) = TRAY_HANDLE.lock() else {
    return;
  };
  let Some(tray) = tray_opt.as_ref() else {
    return;
  };
  match build_menu(app) {
    Ok(menu) => {
      if let Err(err) = tray.set_menu(Some(menu)) {
        log::warn!("Failed to set the tray menu: {err}");
      }
    }
    Err(err) => log::warn!("Failed to build the tray menu: {err}"),
  }
}

impl TrayManager {
  pub fn init(app: AppHandle) -> Result<Self, tauri::Error> {
    let menu = build_menu(&app)?;

    let icon = TRAY_BASE_ICON.clone();

    let tray_builder = TrayIconBuilder::new()
      .icon(icon)
      .menu(&menu)
      .show_menu_on_left_click(false)
      .tooltip(DEFAULT_WINDOW_TITLE)
      .on_menu_event(|app, event| match event.id.as_ref() {
        MENU_ITEM_OPEN_ID => handle_icon_click(app, true),
        MENU_ITEM_QUIT_ID => app.exit(0),
        _ => {}
      })
      .on_tray_icon_event(tray_click_handler);

    // Set icon as template on macOS for proper system theme integration
    #[cfg(target_os = "macos")]
    let tray_builder = tray_builder.icon_as_template(true);

    let tray_icon = tray_builder.build(&app)?;

    // Save tray handle for future updates
    if let Ok(mut tray_lock) = TRAY_HANDLE.lock() {
      *tray_lock = Some(tray_icon.clone());
    }

    Ok(Self)
  }
}

fn tray_click_handler(tray: &TrayIcon, event: TrayIconEvent) {
  let TrayIconEvent::Click {
    button: MouseButton::Left,
    button_state: MouseButtonState::Up,
    ..
  } = event
  else {
    return;
  };

  handle_icon_click(tray.app_handle(), false);
}

fn handle_icon_click(app: &AppHandle, only_open: bool) {
  let active_windows = app.windows();

  if active_windows.is_empty() {
    // No open windows, restore with last URL.
    let url = if let Ok(last_url) = LAST_URL.lock() {
      last_url.clone()
    } else {
      crate::get_app_url().to_string()
    };

    if let Err(err) = crate::open_new_window(app.clone(), url) {
      log::error!("Failed to open window from tray: {:?}", err);
    }
    return;
  }

  // Check if any window is visible (since clicking tray unfocuses windows).
  let visible_window = active_windows.iter().find(|(_, window)| {
    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
  });

  let Some((_, visible_window)) = visible_window else {
    // No visible window, show and focus the first available window.
    if let Some((_, window)) = active_windows.iter().next()
      && let Some(webview_window) = window.get_webview_window(window.label())
    {
      // Also shows a hidden app on macOS
      crate::bring_window_forward(&webview_window);

      // Update icon with notification count
      if let Some(state) = app.try_state::<AppState>()
        && let Ok(app_state) = state.lock()
      {
        let (amount, is_muted) = app_state.total();
        if amount > 0 {
          crate::tray::set_notifications_count(&webview_window, amount, is_muted);
        }
      }
    }
    return;
  };

  if only_open {
    return;
  }

  // If there's a visible window, hide it (closing the last one would quit the app with "Close to tray" off)
  crate::hide_or_close_window(visible_window);
}

// -------------------------------------------------------------------------------------------------
// Platform-specific badge / notification counter implementation
// -------------------------------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod platform {
  use super::*;
  pub fn set_notifications_count(window: &WebviewWindow, amount: i32, is_muted: bool) {
    window
      .set_badge_count(if amount > 0 {
        Some(amount.into())
      } else {
        None
      })
      .unwrap_or_default();
  }
}

#[cfg(not(target_os = "macos"))]
mod platform {
  use super::*;
  pub fn set_notifications_count(window: &WebviewWindow, amount: i32, is_muted: bool) {
    badge::set_badge_count_icon(window, amount, is_muted);
  }
}

pub use platform::set_notifications_count;
