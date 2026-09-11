mod commands;
mod crash_report;
mod keys;
mod models;
mod sessions;
mod store;
mod sync;

use crate::commands::{
    accounts, backup, files, forwards, groups, hosts, keys as key_commands, known_hosts,
    local_terminal, sftp, snippets, ssh as ssh_commands, ssh_import, sync as sync_commands, wol,
};
use sessions::{init_local_terminal_manager, init_session_manager};
use store::init_database;
use sync::init_sync_state;
use tauri::Manager;
use tauri_plugin_prevent_default::Flags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::CONTEXT_MENU)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Err(err) = crash_report::install_panic_hook(app.handle()) {
                eprintln!("crash_report hook: {err}");
            }
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hosts::list_hosts,
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
            crash_report::take_pending_crash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
