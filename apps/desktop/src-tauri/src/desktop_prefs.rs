//! Desktop-only preferences (close-to-tray, etc.), separate from Voice.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopPreferences {
    /// When true, closing the main window hides to the tray instead of quitting.
    pub close_to_tray: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            close_to_tray: false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefsStatus {
    pub preferences: DesktopPreferences,
    pub tray_available: bool,
}

pub struct DesktopPrefs {
    path: PathBuf,
    preferences: Mutex<DesktopPreferences>,
    tray_available: Mutex<bool>,
}

impl DesktopPrefs {
    pub fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let dir = app.path().app_data_dir()?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("desktop.json");
        let preferences = fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<DesktopPreferences>(&data).ok())
            .unwrap_or_default();
        Ok(Self {
            path,
            preferences: Mutex::new(preferences),
            tray_available: Mutex::new(false),
        })
    }

    pub fn close_to_tray(&self) -> bool {
        self.preferences.lock().expect("desktop prefs").close_to_tray
            && *self.tray_available.lock().expect("desktop prefs tray")
    }

    pub fn set_tray_available(&self, available: bool) {
        *self.tray_available.lock().expect("desktop prefs tray") = available;
    }

    pub fn snapshot(&self) -> DesktopPrefsStatus {
        DesktopPrefsStatus {
            preferences: self.preferences.lock().expect("desktop prefs").clone(),
            tray_available: *self.tray_available.lock().expect("desktop prefs tray"),
        }
    }

    fn persist(&self, preferences: &DesktopPreferences) -> Result<(), String> {
        let temporary = self.path.with_extension("pending.json");
        fs::write(
            &temporary,
            serde_json::to_vec(preferences).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::rename(&temporary, &self.path).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn save(&self, preferences: DesktopPreferences) -> Result<DesktopPrefsStatus, String> {
        self.persist(&preferences)?;
        *self.preferences.lock().expect("desktop prefs") = preferences;
        Ok(self.snapshot())
    }
}

#[tauri::command]
pub fn desktop_prefs_get(prefs: State<'_, DesktopPrefs>) -> DesktopPrefsStatus {
    prefs.snapshot()
}

#[tauri::command]
pub fn desktop_prefs_set(
    app: AppHandle,
    prefs: State<'_, DesktopPrefs>,
    preferences: DesktopPreferences,
) -> Result<DesktopPrefsStatus, String> {
    let status = prefs.save(preferences)?;
    crate::voice::VoiceAssistant::sync_tray_visibility(&app);
    Ok(status)
}
