use uuid::Uuid;

use crate::models::{CreateSnippetInput, Snippet};
use crate::store::SharedDatabase;

#[tauri::command]
pub fn list_snippets(db: tauri::State<'_, SharedDatabase>) -> Result<Vec<Snippet>, String> {
    db.lock().list_snippets().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_snippet(
    db: tauri::State<'_, SharedDatabase>,
    input: CreateSnippetInput,
) -> Result<Snippet, String> {
    let snippet = Snippet {
        id: Uuid::new_v4().to_string(),
        name: input.name,
        command: input.command,
        created_at: chrono::Utc::now().timestamp(),
    };
    db.lock()
        .insert_snippet(&snippet)
        .map_err(|err| err.to_string())?;
    Ok(snippet)
}

#[tauri::command]
pub fn update_snippet(
    db: tauri::State<'_, SharedDatabase>,
    id: String,
    input: CreateSnippetInput,
) -> Result<(), String> {
    db.lock()
        .update_snippet(&id, &input.name, &input.command)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_snippet(db: tauri::State<'_, SharedDatabase>, id: String) -> Result<(), String> {
    db.lock().delete_snippet(&id).map_err(|err| err.to_string())
}
