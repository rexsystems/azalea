use crate::models::TrustHostKeyInput;
use crate::sessions::{resolve_host_key_prompt, take_pending_mismatch};
use crate::store::SharedDatabase;

/// Trusts the key that was reported for this session's mismatch. The key
/// material comes from the handshake, never from the caller.
#[tauri::command]
pub fn trust_host_key(
    db: tauri::State<'_, SharedDatabase>,
    input: TrustHostKeyInput,
) -> Result<(), String> {
    let record = take_pending_mismatch(&input.session_id)
        .ok_or_else(|| "No host key change is pending for this session.".to_string())?;

    db.lock()
        .upsert_known_host(&record)
        .map_err(|err| err.to_string())
}

/// Answers the prompt shown the first time a server key is seen.
#[tauri::command]
pub fn respond_host_key(session_id: String, accept: bool) -> Result<(), String> {
    if resolve_host_key_prompt(&session_id, accept) {
        Ok(())
    } else {
        Err("No host key prompt is pending for this session.".to_string())
    }
}
