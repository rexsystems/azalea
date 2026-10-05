// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Fix for WebKitGTK DMA-BUF renderer protocol error on Wayland compositors (Fedora/KDE/GNOME/etc.)
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // Keep alive for the whole process so panics / events flush on exit.
    let _sentry = azalea_lib::crash_report::init_sentry();
    azalea_lib::run()
}

