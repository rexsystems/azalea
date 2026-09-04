use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Hard cap so a stray pick cannot pull a multi-gigabyte file into memory.
const MAX_TEXT_FILE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PickedTextFile {
    pub path: String,
    pub name: String,
    pub contents: String,
}

fn apply_filters(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    filters: &[DialogFilter],
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&filter.name, &extensions);
    }
    builder
}

/// Opens a native picker and returns the chosen file's text. The path never
/// comes from the frontend, so a compromised webview cannot read arbitrary
/// files through this command.
#[tauri::command]
pub async fn pick_text_file(
    app: AppHandle,
    filters: Vec<DialogFilter>,
) -> Result<Option<PickedTextFile>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    apply_filters(app.dialog().file(), &filters).pick_file(move |picked| {
        let _ = tx.send(picked);
    });

    let Some(picked) = rx.await.map_err(|_| "File dialog closed".to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;

    let metadata = std::fs::metadata(&path).map_err(|err| err.to_string())?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err("File is too large to import (16 MB limit).".to_string());
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|_| "File is not valid UTF-8 text.".to_string())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(Some(PickedTextFile {
        path: path.to_string_lossy().into_owned(),
        name,
        contents,
    }))
}

/// Opens a native save dialog and writes `contents` to the chosen path.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    default_name: String,
    filters: Vec<DialogFilter>,
    contents: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    apply_filters(app.dialog().file(), &filters)
        .set_file_name(&default_name)
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });

    let Some(picked) = rx.await.map_err(|_| "File dialog closed".to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;

    std::fs::write(&path, contents).map_err(|err| err.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
