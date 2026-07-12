mod commands;
mod keys;
mod models;
mod sessions;
mod store;

use commands::{files, groups, hosts, keys as key_commands, ssh as ssh_commands};
use sessions::init_session_manager;
use store::init_database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = init_database(&app.handle())?;
            app.manage(db);
            app.manage(init_session_manager());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hosts::list_hosts,
            hosts::create_host,
            hosts::update_host,
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
            ssh_commands::write_terminal,
            ssh_commands::resize_terminal,
            ssh_commands::disconnect_ssh,
            files::read_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
