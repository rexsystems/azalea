use crate::models::{KnownHostRecord, TrustHostKeyInput};
use crate::store::SharedDatabase;

#[tauri::command]
pub fn trust_host_key(
    db: tauri::State<'_, SharedDatabase>,
    input: TrustHostKeyInput,
) -> Result<(), String> {
    let record = KnownHostRecord {
        hostname: input.hostname,
        port: input.port,
        key_type: input.key_type,
        public_key: input.public_key,
        fingerprint: input.fingerprint,
        created_at: chrono::Utc::now().timestamp(),
    };
    db.lock()
        .upsert_known_host(&record)
        .map_err(|err| err.to_string())
}
