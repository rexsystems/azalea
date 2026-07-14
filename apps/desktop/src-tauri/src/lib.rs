mod commands;
mod keys;
mod models;
mod sessions;
mod store;
mod sync;

use commands::{
    backup, files, forwards, groups, hosts, keys as key_commands, known_hosts,
    local_terminal, sftp, snippets, ssh as ssh_commands, sync as sync_commands,
};
use sessions::{init_local_terminal_manager, init_session_manager};
use store::init_database;
use sync::init_sync_state;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Loads SUPABASE_URL / SUPABASE_ANON_KEY in dev; silently ignored if absent.
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = init_database(&app.handle())?;
            app.manage(db);
            app.manage(init_session_manager());
            app.manage(init_local_terminal_manager());
            app.manage(init_sync_state());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hosts::list_hosts,
            hosts::create_host,
            hosts::update_host,
            hosts::host_has_password,
            hosts::delete_host,
            groups::list_groups,
            groups::create_group,
            groups::update_group,
            groups::delete_group,
            groups::move_host_to_group,
            key_commands::list_keys,
            key_commands::generate_key,
            key_commands::import_key,
            key_commands::delete_key,
            ssh_commands::prepare_ssh,
            ssh_commands::start_ssh,
            ssh_commands::reconnect_ssh,
            ssh_commands::write_terminal,
            ssh_commands::resize_terminal,
            ssh_commands::disconnect_ssh,
            files::read_text_file,
            files::write_text_file,
            backup::export_backup,
            backup::import_backup,
            backup::import_data_file,
            sftp::sftp_list,
            sftp::sftp_download,
            sftp::sftp_upload,
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
            sync_commands::sync_status,
            sync_commands::sync_login,
            sync_commands::sync_browser_login,
            sync_commands::sync_logout,
            sync_commands::sync_setup_passphrase,
            sync_commands::sync_unlock,
            sync_commands::sync_now,
            local_terminal::start_local_terminal,
            local_terminal::write_local_terminal,
            local_terminal::resize_local_terminal,
            local_terminal::close_local_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
