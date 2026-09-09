use crate::db::Database;
use crate::mail::MailConfig;

pub struct AppState {
    pub db: Database,
    pub jwt_secret: String,
    pub mail: Option<MailConfig>,
}
