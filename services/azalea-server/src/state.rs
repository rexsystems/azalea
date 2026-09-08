use crate::db::Database;
use crate::mail::MailConfig;

pub struct AppState {
    pub db: Database,
    pub jwt_secret: String,
    pub setup_secret: Option<String>,
    pub mail: Option<MailConfig>,
}
