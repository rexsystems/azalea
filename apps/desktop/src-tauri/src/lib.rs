mod commands;
pub mod crash_report;
mod keys;
mod models;
mod sessions;
mod store;
mod sync;
#[cfg(desktop)]
mod desktop_prefs;
#[cfg(desktop)]
mod voice;

use crate::commands::{
    accounts, ai, backup, files, forwards, groups, hosts, keys as key_commands, known_hosts,
    local_terminal, sftp, snippets, ssh as ssh_commands, ssh_import, sync as sync_commands, wol,
};
use sessions::{init_local_terminal_manager, init_session_manager};
use store::init_database;
use sync::init_sync_state;
use tauri::Manager;
use tauri_plugin_prevent_default::Flags;

/// Parse `+67` / `+build.67` from a semver version.
fn semver_build_number(version: &semver::Version) -> Option<u64> {
    let raw = version.build.as_str();
    if raw.is_empty() {
        return None;
    }
    raw.strip_prefix("build.")
        .unwrap_or(raw)
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
}

fn version_with_build_is_newer(current: &semver::Version, remote: &semver::Version) -> bool {
    if remote.major != current.major
        || remote.minor != current.minor
        || remote.patch != current.patch
        || remote.pre != current.pre
    {
        return remote > current;
    }
    match (semver_build_number(current), semver_build_number(remote)) {
        (Some(cur), Some(rem)) => rem > cur,
        // Stamped release is newer than an unstamped local/dev build of the same core version.
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (None, None) => false,
    }
}

#[cfg(test)]
mod version_compare_tests {
    use super::*;
    use semver::Version;

    #[test]
    fn build_metadata_compares() {
        let a = Version::parse("0.1.1+66").unwrap();
        let b = Version::parse("0.1.1+67").unwrap();
        assert!(version_with_build_is_newer(&a, &b));
        assert!(!version_with_build_is_newer(&b, &a));
        assert!(!version_with_build_is_newer(&b, &b));
    }

    #[test]
    fn unstamped_loses_to_stamped() {
        let local = Version::parse("0.1.1").unwrap();
        let remote = Version::parse("0.1.1+67").unwrap();
        assert!(version_with_build_is_newer(&local, &remote));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let _ = dotenvy::dotenv();

    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::CONTEXT_MENU)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                // Semver ignores `+build` metadata, so 0.1.1+66 == 0.1.1+67 by default.
                // Compare numeric build metadata when major.minor.patch match.
                .default_version_comparator(|current, release| {
                    version_with_build_is_newer(&current, &release.version)
                })
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let registry = accounts::init_accounts(&app.handle())?;
            let active = registry.lock().active().cloned();
            let active_id = active
                .as_ref()
                .map(|a| a.id.clone())
                .ok_or_else(|| anyhow::anyhow!("No active account"))?;
            let db = init_database(&app.handle(), &active_id)?;
            keys::keyring::init_storage(&app.handle())?;
            let sync_state = init_sync_state();
            if let Some(account) = active {
                let mut sync = sync_state.blocking_lock();
                sync.bind_account(account.id, account.base_url, account.web_url);
            }
            app.manage(registry);
            app.manage(db);
            app.manage(init_session_manager());
            app.manage(init_local_terminal_manager());
            app.manage(sync_state);
            app.manage(ai::AiCancelMap::default());
            app.manage(ai::SharedVoiceAiConfig::default());
            app.manage(sync_commands::BrowserLoginState::default());
            #[cfg(desktop)]
            {
                let desktop = desktop_prefs::DesktopPrefs::new(&app.handle())?;
                app.manage(desktop);
                let voice = voice::VoiceAssistant::new(&app.handle())?;
                app.manage(voice.clone());
                if let Err(error) = voice::setup_tray(&app.handle(), &voice) {
                    eprintln!("Could not initialize the system tray: {error}");
                }
                let app = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || voice.restart(app));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.label() == "main"
                        && voice::VoiceAssistant::should_close_to_tray(window.app_handle())
                    {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
            #[cfg(mobile)]
            {
                let _ = (window, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            hosts::list_hosts,
            #[cfg(desktop)]
            voice::voice_status,
            #[cfg(desktop)]
            voice::voice_set_preferences,
            #[cfg(desktop)]
            voice::voice_download_model,
            #[cfg(desktop)]
            voice::voice_restart,
            #[cfg(desktop)]
            voice::voice_test_reply,
            #[cfg(desktop)]
            voice::voice_download_tts,
            #[cfg(desktop)]
            desktop_prefs::desktop_prefs_get,
            #[cfg(desktop)]
            desktop_prefs::desktop_prefs_set,
            hosts::create_host,
            hosts::update_host,
            hosts::host_has_password,
            hosts::delete_host,
            wol::wake_on_lan,
            groups::list_groups,
            groups::create_group,
            groups::update_group,
            groups::delete_group,
            groups::move_host_to_group,
            key_commands::list_keys,
            key_commands::generate_key,
            key_commands::import_key,
            key_commands::delete_key,
            key_commands::private_key_present,
            key_commands::export_private_key,
            key_commands::install_public_key,
            ssh_import::scan_ssh_dir,
            ssh_import::import_ssh_dir,
            ssh_commands::prepare_ssh,
            ssh_commands::start_ssh,
            ssh_commands::reconnect_ssh,
            ssh_commands::write_terminal,
            ssh_commands::resize_terminal,
            ssh_commands::disconnect_ssh,
            ssh_commands::disconnect_all_ssh,
            files::pick_text_file,
            files::save_text_file,
            backup::export_backup,
            backup::import_backup,
            backup::import_data_file,
            sftp::sftp_list,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::sftp_cancel_transfer,
            sftp::sftp_read_text,
            sftp::sftp_write_text,
            snippets::list_snippets,
            snippets::create_snippet,
            snippets::update_snippet,
            snippets::delete_snippet,
            forwards::list_port_forwards,
            forwards::create_port_forward,
            forwards::delete_port_forward,
            forwards::start_forward,
            forwards::stop_forward,
            forwards::list_active_forwards,
            known_hosts::trust_host_key,
            known_hosts::respond_host_key,
            sync_commands::sync_status,
            sync_commands::sync_browser_login,
            sync_commands::sync_cancel_browser_login,
            sync_commands::sync_submit_browser_login_code,
            sync_commands::sync_password_login,
            sync_commands::probe_selfhost,
            sync_commands::sync_logout,
            sync_commands::sync_setup_passphrase,
            sync_commands::sync_unlock,
            sync_commands::sync_preview,
            sync_commands::sync_now,
            local_terminal::start_local_terminal,
            local_terminal::write_local_terminal,
            local_terminal::resize_local_terminal,
            local_terminal::close_local_terminal,
            local_terminal::close_all_local_terminals,
            accounts::list_accounts,
            accounts::active_account,
            accounts::accounts_onboarded,
            accounts::set_accounts_onboarded,
            accounts::connect_selfhost,
            accounts::add_account,
            accounts::rename_account,
            accounts::switch_account,
            accounts::remove_account,
            accounts::copy_account_data,
            crash_report::set_crash_reporting_enabled,
            crash_report::report_client_error,
            ai::ai_set_api_key,
            ai::ai_clear_api_key,
            ai::ai_api_key_present,
            ai::ai_list_models,
            ai::ai_chat,
            ai::ai_chat_stream,
            ai::ai_chat_cancel,
            ai::ai_server_config,
            ai::ai_web_search,
            ai::ai_sync_voice_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
