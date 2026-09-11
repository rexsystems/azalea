//! Simple in-memory token-bucket rate limiter for /v1/auth/*.
//!
//! Two axes are limited independently:
//!   * per client IP (defense against a single attacker)
//!   * per identifier (defense against rotating-IP credential stuffing)
//!
//! Buckets live in-process; a server restart resets them. This is intentional
//! for a small self-hosted service. If you run behind multiple replicas, put a
//! WAF / rate-limit in front.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    capacity: u32,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<String, Bucket>>,
}

#[derive(Clone, Copy)]
struct Bucket {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    /// `capacity` is the burst size. `per` is the window over which `capacity`
    /// tokens are replenished. Example: `new(5, Duration::from_secs(60))` = 5
    /// requests per minute with a burst of 5.
    pub fn new(capacity: u32, per: Duration) -> Self {
        let refill = capacity as f64 / per.as_secs_f64().max(1.0);
        Self {
            capacity,
            refill_per_sec: refill,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Consume one token for `key`. Returns true if allowed, false if the
    /// caller should be told "too many requests".
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().unwrap();

        // Occasional GC so unbounded keys (per-IP over years) don't leak.
        if buckets.len() > 4096 {
            buckets.retain(|_, b| now.duration_since(b.last) < Duration::from_secs(3600));
        }

        let bucket = buckets.entry(key.to_string()).or_insert(Bucket {
            tokens: self.capacity as f64,
            last: now,
        });
        let elapsed = now.duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_per_sec).min(self.capacity as f64);
        bucket.last = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
