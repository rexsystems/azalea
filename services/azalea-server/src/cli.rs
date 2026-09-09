use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};
use rusqlite::params;
use uuid::Uuid;

use crate::auth::hash_password;
use crate::db::{now_rfc3339, Database};

#[derive(Parser, Debug)]
#[command(
    name = "azalea-server",
    about = "Azalea sync API server and admin CLI",
    version
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Run the HTTP API (default)
    Serve,
    /// Create the first admin (fails if an admin already exists)
    Bootstrap {
        #[arg(long, env = "AZALEA_BOOTSTRAP_EMAIL")]
        email: String,
        #[arg(long, env = "AZALEA_BOOTSTRAP_PASSWORD")]
        password: String,
        #[arg(long, default_value = "Azalea")]
        instance: String,
    },
    /// Manage users in the local SQLite database
    #[command(subcommand)]
    User(UserCommand),
    /// Toggle signup / show settings
    #[command(subcommand)]
    Settings(SettingsCommand),
}

#[derive(Subcommand, Debug)]
pub enum UserCommand {
    /// List users
    List,
    /// Create a user
    Create {
        #[arg(long)]
        email: String,
        #[arg(long)]
        password: String,
        #[arg(long, default_value = "user", value_parser = ["user", "admin"])]
        role: String,
        #[arg(long, default_value = "free", value_parser = ["free", "pro"])]
        plan: String,
    },
    /// Set a user's password
    SetPassword {
        #[arg(long)]
        email: String,
        #[arg(long)]
        password: String,
    },
    /// Disable a user
    Disable {
        #[arg(long)]
        email: String,
    },
    /// Enable a user
    Enable {
        #[arg(long)]
        email: String,
    },
    /// Set role (user|admin)
    SetRole {
        #[arg(long)]
        email: String,
        #[arg(long, value_parser = ["user", "admin"])]
        role: String,
    },
    /// Set plan (free|pro)
    SetPlan {
        #[arg(long)]
        email: String,
        #[arg(long, value_parser = ["free", "pro"])]
        plan: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum SettingsCommand {
    /// Print current settings
    Show,
    /// Enable or disable public signup
    Signup {
        #[arg(long)]
        enabled: bool,
    },
}

pub fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("AZALEA_DATA_DIR").unwrap_or_else(|_| "./data".into()))
}

pub fn open_db(dir: &Path) -> anyhow::Result<Database> {
    std::fs::create_dir_all(dir)?;
    let db = Database::open(&dir.join("azalea.db"))?;
    db.migrate()?;
    Ok(db)
}

pub fn run_cli(command: Command) -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let dir = data_dir();
    match command {
        Command::Serve => unreachable!("serve is handled in main"),
        Command::Bootstrap {
            email,
            password,
            instance,
        } => bootstrap(&dir, &email, &password, &instance),
        Command::User(cmd) => run_user(&dir, cmd),
        Command::Settings(cmd) => run_settings(&dir, cmd),
    }
}

fn bootstrap(dir: &Path, email: &str, password: &str, instance: &str) -> anyhow::Result<()> {
    let email = normalize_email(email)?;
    validate_password(password)?;
    let db = open_db(dir)?;
    let admins: i64 = db.with_conn(|conn| {
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin'",
            [],
            |r| r.get(0),
        )?)
    })?;
    if admins > 0 {
        anyhow::bail!("already bootstrapped (an admin user exists)");
    }

    let password_hash = hash_password(password).map_err(|e| anyhow::anyhow!("{e}"))?;
    let user_id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    let instance = instance.trim();
    let instance = if instance.is_empty() { "Azalea" } else { instance };

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'admin', 'pro', 0, ?4, ?4)",
            params![user_id, email, password_hash, now],
        )?;
        conn.execute(
            "UPDATE settings SET instance_name = ?1 WHERE id = 1",
            params![instance],
        )?;
        Ok(())
    })?;

    println!("ok: admin created ({email})");
    println!("instance: {instance}");
    Ok(())
}

fn run_user(dir: &Path, cmd: UserCommand) -> anyhow::Result<()> {
    let db = open_db(dir)?;
    match cmd {
        UserCommand::List => {
            let rows: Vec<(String, String, String, String, i64, String)> = db.with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, email, role, plan, disabled, created_at FROM users ORDER BY created_at",
                )?;
                let iter = stmt.query_map([], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                })?;
                let mut out = Vec::new();
                for row in iter {
                    out.push(row?);
                }
                Ok(out)
            })?;
            if rows.is_empty() {
                println!("(no users)");
                return Ok(());
            }
            println!(
                "{:<36}  {:<28}  {:<6}  {:<5}  {:<8}  {}",
                "id", "email", "role", "plan", "status", "created"
            );
            for (id, email, role, plan, disabled, created) in rows {
                let status = if disabled != 0 { "disabled" } else { "active" };
                println!("{id:<36}  {email:<28}  {role:<6}  {plan:<5}  {status:<8}  {created}");
            }
            Ok(())
        }
        UserCommand::Create {
            email,
            password,
            role,
            plan,
        } => {
            let email = normalize_email(&email)?;
            validate_password(&password)?;
            let password_hash = hash_password(&password).map_err(|e| anyhow::anyhow!("{e}"))?;
            let id = Uuid::new_v4().to_string();
            let now = now_rfc3339();
            let result = db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO users (id, email, password_hash, role, plan, disabled, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
                    params![id, email, password_hash, role, plan, now],
                )?;
                Ok(())
            });
            match result {
                Ok(()) => {
                    println!("ok: created {email} ({role}/{plan})");
                    Ok(())
                }
                Err(e) if e.to_string().contains("UNIQUE") => {
                    anyhow::bail!("user already exists: {email}")
                }
                Err(e) => Err(e),
            }
        }
        UserCommand::SetPassword { email, password } => {
            let email = normalize_email(&email)?;
            validate_password(&password)?;
            let password_hash = hash_password(&password).map_err(|e| anyhow::anyhow!("{e}"))?;
            let now = now_rfc3339();
            let n = db.with_conn(|conn| {
                Ok(conn.execute(
                    "UPDATE users SET password_hash = ?2, updated_at = ?3 WHERE email = ?1 COLLATE NOCASE",
                    params![email, password_hash, now],
                )?)
            })?;
            if n == 0 {
                anyhow::bail!("user not found: {email}");
            }
            db.with_conn(|conn| {
                conn.execute(
                    "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?1 COLLATE NOCASE)",
                    params![email],
                )?;
                Ok(())
            })?;
            println!("ok: password updated for {email}");
            Ok(())
        }
        UserCommand::Disable { email } => set_disabled(dir, &email, true),
        UserCommand::Enable { email } => set_disabled(dir, &email, false),
        UserCommand::SetRole { email, role } => {
            let email = normalize_email(&email)?;
            let now = now_rfc3339();
            let n = db.with_conn(|conn| {
                Ok(conn.execute(
                    "UPDATE users SET role = ?2, updated_at = ?3 WHERE email = ?1 COLLATE NOCASE",
                    params![email, role, now],
                )?)
            })?;
            if n == 0 {
                anyhow::bail!("user not found: {email}");
            }
            println!("ok: {email} role={role}");
            Ok(())
        }
        UserCommand::SetPlan { email, plan } => {
            let email = normalize_email(&email)?;
            let now = now_rfc3339();
            let n = db.with_conn(|conn| {
                Ok(conn.execute(
                    "UPDATE users SET plan = ?2, updated_at = ?3 WHERE email = ?1 COLLATE NOCASE",
                    params![email, plan, now],
                )?)
            })?;
            if n == 0 {
                anyhow::bail!("user not found: {email}");
            }
            println!("ok: {email} plan={plan}");
            Ok(())
        }
    }
}

fn set_disabled(dir: &Path, email: &str, disabled: bool) -> anyhow::Result<()> {
    let db = open_db(dir)?;
    let email = normalize_email(email)?;
    let now = now_rfc3339();
    let flag = if disabled { 1 } else { 0 };
    let n = db.with_conn(|conn| {
        Ok(conn.execute(
            "UPDATE users SET disabled = ?2, updated_at = ?3 WHERE email = ?1 COLLATE NOCASE",
            params![email, flag, now],
        )?)
    })?;
    if n == 0 {
        anyhow::bail!("user not found: {email}");
    }
    if disabled {
        db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?1 COLLATE NOCASE)",
                params![email],
            )?;
            Ok(())
        })?;
        println!("ok: disabled {email}");
    } else {
        println!("ok: enabled {email}");
    }
    Ok(())
}

fn run_settings(dir: &Path, cmd: SettingsCommand) -> anyhow::Result<()> {
    let db = open_db(dir)?;
    match cmd {
        SettingsCommand::Show => {
            let row: (i64, String, String, i64, i64, String) = db.with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT signup_enabled, captcha_provider, captcha_site_key,
                            free_limit_bytes, pro_limit_bytes, instance_name
                     FROM settings WHERE id = 1",
                    [],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get(4)?,
                            r.get(5)?,
                        ))
                    },
                )?)
            })?;
            println!("instance_name:     {}", row.5);
            println!("signup_enabled:    {}", row.0 != 0);
            println!("captcha_provider:  {}", row.1);
            println!("captcha_site_key:  {}", row.2);
            println!("free_limit_bytes:  {}", row.3);
            println!("pro_limit_bytes:   {}", row.4);
            Ok(())
        }
        SettingsCommand::Signup { enabled } => {
            let flag = if enabled { 1 } else { 0 };
            db.with_conn(|conn| {
                conn.execute(
                    "UPDATE settings SET signup_enabled = ?1 WHERE id = 1",
                    params![flag],
                )?;
                Ok(())
            })?;
            println!("ok: signup_enabled={enabled}");
            Ok(())
        }
    }
}

fn normalize_email(email: &str) -> anyhow::Result<String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 3 {
        anyhow::bail!("invalid email");
    }
    Ok(email)
}

fn validate_password(password: &str) -> anyhow::Result<()> {
    if password.len() < 8 {
        anyhow::bail!("password must be at least 8 characters");
    }
    Ok(())
}
