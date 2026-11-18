//! Renders Azalea hosts as a managed block at the top of `~/.ssh/config`, so
//! VS Code Remote-SSH and plain `ssh` see them. Lines outside the block are kept.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::Host;

pub const BLOCK_BEGIN: &str = "# BEGIN Azalea managed hosts";
pub const BLOCK_END: &str = "# END Azalea managed hosts";

pub struct RenderedHost<'a> {
    pub alias: String,
    pub host: &'a Host,
    /// `IdentityFile` target; the private half stays in Azalea and signs through the agent.
    pub public_key_file: Option<String>,
}

/// Host values come from sync, so anything that could start a new ssh_config
/// directive (newline, quote, comment) disqualifies the host.
fn safe_value(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '"' || c == '#' || c == '\\')
}

fn alias_for(name: &str, fallback: &str) -> String {
    let mut alias = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            alias.push(c.to_ascii_lowercase());
        } else if (c.is_whitespace() || c == '/') && !alias.ends_with('-') {
            alias.push('-');
        }
    }
    let alias = alias.trim_matches('-').to_string();
    if alias.is_empty() {
        fallback.to_string()
    } else {
        alias
    }
}

pub fn plan_hosts<'a>(
    hosts: &'a [Host],
    mut public_key_file: impl FnMut(&str) -> Option<String>,
) -> Vec<RenderedHost<'a>> {
    let mut used = HashSet::new();
    let mut out = Vec::new();
    for host in hosts {
        if !safe_value(&host.hostname) || !safe_value(&host.username) {
            continue;
        }
        let base = alias_for(&host.name, &host.hostname);
        let mut alias = base.clone();
        let mut n = 2;
        while !used.insert(alias.clone()) {
            alias = format!("{base}-{n}");
            n += 1;
        }
        out.push(RenderedHost {
            alias,
            host,
            public_key_file: host.key_id.as_deref().and_then(&mut public_key_file),
        });
    }
    out
}

pub fn render_block(hosts: &[RenderedHost<'_>], agent_socket: Option<&str>) -> String {
    let mut block = String::new();
    block.push_str(BLOCK_BEGIN);
    block.push_str("\n# Written by Azalea. Edits inside this block are overwritten.\n");
    for entry in hosts {
        let host = entry.host;
        block.push_str(&format!("\nHost {}\n", entry.alias));
        block.push_str(&format!("  HostName {}\n", host.hostname));
        if host.port != 22 {
            block.push_str(&format!("  Port {}\n", host.port));
        }
        block.push_str(&format!("  User {}\n", host.username));
        if let (Some(key_file), Some(socket)) = (&entry.public_key_file, agent_socket) {
            block.push_str(&format!("  IdentityAgent \"{socket}\"\n"));
            block.push_str(&format!("  IdentityFile \"{key_file}\"\n"));
            block.push_str("  IdentitiesOnly yes\n");
        }
    }
    // Lines after the block were top-level; `Host *` keeps them applying to every host.
    block.push_str("\nHost *\n");
    block.push_str(BLOCK_END);
    block.push('\n');
    block
}

pub fn strip_block(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut inside = false;
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim();
        if !inside && trimmed == BLOCK_BEGIN {
            inside = true;
            continue;
        }
        if inside {
            if trimmed == BLOCK_END {
                inside = false;
            }
            continue;
        }
        out.push_str(line);
    }
    out.trim_start_matches('\n').to_string()
}

pub fn merge(existing: &str, block: Option<&str>) -> String {
    let rest = strip_block(existing);
    match block {
        Some(block) if rest.is_empty() => block.to_string(),
        Some(block) => format!("{block}\n{rest}"),
        None => rest,
    }
}

/// Writes through a symlinked config (dotfile repos) and keeps a one-time backup.
pub fn write_config(path: &Path, content: &str) -> anyhow::Result<bool> {
    let target: PathBuf = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let existing = fs::read_to_string(&target).unwrap_or_default();
    if existing == content {
        return Ok(false);
    }
    let dir = target
        .parent()
        .ok_or_else(|| anyhow::anyhow!("ssh config has no parent directory"))?;
    create_private_dir(dir)?;

    let backup = dir.join("config.azalea-backup");
    if !existing.is_empty() && !existing.contains(BLOCK_BEGIN) && !backup.exists() {
        fs::write(&backup, &existing)?;
        restrict(&backup)?;
    }

    let pending = dir.join(".config.azalea-pending");
    fs::write(&pending, content)?;
    restrict(&pending)?;
    fs::rename(&pending, &target)?;
    Ok(true)
}

pub fn create_private_dir(dir: &Path) -> anyhow::Result<()> {
    if !dir.exists() {
        fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}

pub fn restrict(path: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(name: &str, hostname: &str, key: Option<&str>) -> Host {
        Host {
            id: format!("id-{name}"),
            name: name.into(),
            hostname: hostname.into(),
            port: 22,
            username: "root".into(),
            auth_type: if key.is_some() { "key" } else { "password" }.into(),
            key_id: key.map(Into::into),
            group_id: None,
            mac_address: None,
            os_id: None,
            last_connected_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn aliases_are_slugged_and_unique() {
        let hosts = vec![
            host("Prod Web", "10.0.0.1", None),
            host("prod web", "10.0.0.2", None),
            host("!!!", "box.example.org", None),
        ];
        let plan = plan_hosts(&hosts, |_| None);
        let aliases: Vec<_> = plan.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(aliases, ["prod-web", "prod-web-2", "box.example.org"]);
    }

    #[test]
    fn injected_values_are_skipped() {
        let hosts = vec![
            host("evil", "a.example\n  ProxyCommand touch /tmp/x", None),
            host("ok", "b.example", None),
        ];
        let plan = plan_hosts(&hosts, |_| None);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].alias, "ok");
    }

    #[test]
    fn merge_replaces_block_and_keeps_user_lines() {
        let hosts = vec![host("web", "10.0.0.1", Some("k1"))];
        let plan = plan_hosts(&hosts, |id| Some(format!("~/.azalea/public-keys/{id}.pub")));
        let block = render_block(&plan, Some("~/.azalea/agent.sock"));
        assert!(block.contains("IdentityAgent \"~/.azalea/agent.sock\""));

        let user = "ServerAliveInterval 30\n\nHost mine\n  HostName x\n";
        let first = merge(user, Some(&block));
        assert!(first.starts_with(BLOCK_BEGIN));
        assert!(first.ends_with(user));

        if std::process::Command::new("ssh").arg("-V").output().is_ok() {
            let file = std::env::temp_dir().join(format!("azalea-cfg-{}", uuid::Uuid::new_v4()));
            fs::write(&file, &first).unwrap();
            let resolve = |alias: &str| {
                let out = std::process::Command::new("ssh")
                    .args(["-G", "-F", file.to_str().unwrap(), alias])
                    .output()
                    .unwrap();
                String::from_utf8(out.stdout).unwrap()
            };
            let web = resolve("web");
            assert!(web.contains("hostname 10.0.0.1"));
            assert!(web.contains("/.azalea/agent.sock\n"));
            assert!(web.contains("identityfile ~/.azalea/public-keys/k1.pub"));
            assert!(web.contains("identitiesonly yes"));
            assert!(resolve("mine").contains("serveraliveinterval 30"));
            fs::remove_file(file).ok();
        }

        let second = merge(&first, Some(&block));
        assert_eq!(first, second);
        assert_eq!(merge(&second, None), user);
    }
}
