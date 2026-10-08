use serde_json::{json, Value};
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::Duration,
};

struct Fixture {
    path: PathBuf,
    server: Option<Child>,
}
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("azalea-bootstrap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self { path, server: None }
    }
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_azalea-server"));
        command
            .current_dir(&self.path)
            .env("AZALEA_DATA_DIR", &self.path);
        command
    }
    fn bootstrap(&self, password: &str) -> std::process::Output {
        self.command()
            .args([
                "bootstrap",
                "--email=Admin@Example.com",
                &format!("--password={password}"),
                "--instance=Test server",
            ])
            .output()
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(server) = &mut self.server {
            let _ = server.kill();
            let _ = server.wait();
        }
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[tokio::test]
async fn bootstrap_creates_a_real_admin_that_can_sign_in_while_server_is_running() {
    let mut fixture = Fixture::new();
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = socket.local_addr().unwrap();
    drop(socket);
    fixture.server = Some(
        fixture
            .command()
            .arg("serve")
            .env("AZALEA_BIND", address.to_string())
            .env("AZALEA_JWT_SECRET", "bootstrap-integration-test-secret")
            .env_remove("RESEND_API_KEY")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let base = format!("http://{address}");
    let mut ready = false;
    for _ in 0..50 {
        if client.get(format!("{base}/v1/health")).send().await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(ready, "test API did not start");
    let password = "-special $password 'with spaces' ";
    let created = fixture.bootstrap(password);
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stderr)
    );
    let response = client
        .post(format!("{base}/v1/auth/login"))
        .header("x-azalea-client", "desktop")
        .json(&json!({"email":"ADMIN@example.com","password":password}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let session: Value = response.json().await.unwrap();
    assert_eq!(session["user"]["role"], "admin");
    let settings = client
        .get(format!("{base}/v1/admin/settings"))
        .bearer_auth(session["access_token"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(settings.status(), 200);
    assert_eq!(
        settings.json::<Value>().await.unwrap()["instance_name"],
        "Test server"
    );
    assert!(fixture.bootstrap(password).status.success());
    assert!(!fixture.bootstrap("incorrect-password").status.success());
    let db = rusqlite::Connection::open(fixture.path.join("azalea.db")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM users WHERE role='admin' AND disabled=0",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn failed_instance_write_rolls_back_admin_creation() {
    let fixture = Fixture::new();
    assert!(fixture
        .command()
        .args(["user", "list"])
        .output()
        .unwrap()
        .status
        .success());
    let db = rusqlite::Connection::open(fixture.path.join("azalea.db")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(!fixture.bootstrap("test-password").status.success());
    assert_eq!(
        db.query_row("SELECT count(*) FROM users", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn bootstrap_waits_for_a_concurrent_sqlite_writer_instead_of_failing_locked() {
    let fixture = Fixture::new();
    assert!(fixture
        .command()
        .args(["user", "list"])
        .output()
        .unwrap()
        .status
        .success());
    let db = rusqlite::Connection::open(fixture.path.join("azalea.db")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    let release = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        db.execute_batch("COMMIT").unwrap();
    });
    let result = fixture.bootstrap("test-password");
    release.join().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
