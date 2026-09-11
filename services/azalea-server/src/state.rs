use std::time::Duration;

use crate::db::Database;
use crate::mail::MailConfig;
use crate::ratelimit::RateLimiter;

pub struct AppState {
    pub db: Database,
    pub jwt_secret: String,
    pub mail: Option<MailConfig>,
    /// Origins allowed for browser CORS. Empty = no CORS layer at all
    /// (same-origin only, which is what you want behind an nginx that already
    /// serves the web app and reverse-proxies /api/).
    #[allow(dead_code)]
    pub allowed_origins: Vec<String>,
    /// When true, the refresh cookie omits the `Secure` attribute so it works
    /// over plain-HTTP localhost during development. Never enable in prod.
    pub allow_insecure_cookie: bool,
    /// Rate limiter shared across /v1/auth/login and /v1/auth/desktop/exchange.
    pub auth_login_limiter: RateLimiter,
    /// Rate limiter shared across /v1/auth/register, /v1/auth/forgot-password,
    /// /v1/auth/reset-password, /v1/auth/desktop/begin, and
    /// /v1/auth/desktop/approve.
    pub auth_write_limiter: RateLimiter,
    /// Higher-throughput limiter for /v1/auth/refresh (30 req/min per IP).
    pub auth_refresh_limiter: RateLimiter,
    /// Per-identifier (email hash) limiter for login and forgot-password to
    /// defeat rotating-IP credential stuffing.
    pub auth_identifier_limiter: RateLimiter,
}

impl AppState {
    pub fn secure_cookies(&self) -> bool {
        !self.allow_insecure_cookie
    }

    /// Build the standard set of auth-endpoint rate limiters. Kept here so
    /// tests can construct an AppState without repeating the constants.
    pub fn default_limiters() -> AuthLimiters {
        AuthLimiters {
            login: RateLimiter::new(5, Duration::from_secs(60)),
            write: RateLimiter::new(5, Duration::from_secs(60)),
            refresh: RateLimiter::new(30, Duration::from_secs(60)),
            identifier: RateLimiter::new(10, Duration::from_secs(60 * 60)),
        }
    }
}

pub struct AuthLimiters {
    pub login: RateLimiter,
    pub write: RateLimiter,
    pub refresh: RateLimiter,
    pub identifier: RateLimiter,
}
