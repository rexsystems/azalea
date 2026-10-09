//! Piper neural TTS: download voices + runtime, synthesize WAV, play via OS tools.

use md5::{Digest, Md5};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

const HF_VOICE_BASE: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const PIPER_RELEASE: &str = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2";

pub struct VoiceSpec {
    pub id: &'static str,
    pub onnx_rel: &'static str,
    pub onnx_bytes: u64,
    pub onnx_md5: &'static str,
    pub json_rel: &'static str,
    pub json_bytes: u64,
    pub json_md5: &'static str,
}

pub const EN_LESSAC: VoiceSpec = VoiceSpec {
    id: "en_US-lessac-medium",
    onnx_rel: "en/en_US/lessac/medium/en_US-lessac-medium.onnx",
    onnx_bytes: 63_201_294,
    onnx_md5: "2fc642b535197b6305c7c8f92dc8b24f",
    json_rel: "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
    json_bytes: 4_885,
    json_md5: "c1f2b7bddefe113f3255ff9ef234cfd3",
};

pub const RO_MIHAI: VoiceSpec = VoiceSpec {
    id: "ro_RO-mihai-medium",
    onnx_rel: "ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx",
    onnx_bytes: 63_201_294,
    onnx_md5: "45f4253916c93d3d05ad3fe1b07ea4f3",
    json_rel: "ro/ro_RO/mihai/medium/ro_RO-mihai-medium.onnx.json",
    json_bytes: 4_877,
    json_md5: "f820f8ba65a8646c68792be581b85144",
};

pub fn tts_root(voice_path: &Path) -> PathBuf {
    voice_path.join("tts")
}

pub fn voice_dir(voice_path: &Path, id: &str) -> PathBuf {
    tts_root(voice_path).join(id)
}

pub fn piper_bin(voice_path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        tts_root(voice_path).join("piper").join("piper.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        tts_root(voice_path).join("piper").join("piper")
    }
}

pub fn valid_file(path: &Path, expected_bytes: u64, expected_md5: &str) -> bool {
    if fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) != expected_bytes {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut hash = Md5::new();
    let mut buffer = [0u8; 65536];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => hash.update(&buffer[..count]),
            Err(_) => return false,
        }
    }
    hex::encode(hash.finalize()) == expected_md5
}

pub fn voice_ready(voice_path: &Path, spec: &VoiceSpec) -> bool {
    let dir = voice_dir(voice_path, spec.id);
    valid_file(&dir.join(format!("{}.onnx", spec.id)), spec.onnx_bytes, spec.onnx_md5)
        && valid_file(
            &dir.join(format!("{}.onnx.json", spec.id)),
            spec.json_bytes,
            spec.json_md5,
        )
}

pub fn piper_ready(voice_path: &Path) -> bool {
    piper_bin(voice_path).is_file()
}

pub fn any_tts_ready(voice_path: &Path) -> bool {
    piper_ready(voice_path) && (voice_ready(voice_path, &EN_LESSAC) || voice_ready(voice_path, &RO_MIHAI))
}

pub fn pick_voice(voice_path: &Path, language: &str) -> Option<&'static VoiceSpec> {
    match language {
        "ro" if voice_ready(voice_path, &RO_MIHAI) => Some(&RO_MIHAI),
        "ro" if voice_ready(voice_path, &EN_LESSAC) => Some(&EN_LESSAC),
        "en" if voice_ready(voice_path, &EN_LESSAC) => Some(&EN_LESSAC),
        "auto" => {
            if voice_ready(voice_path, &EN_LESSAC) {
                Some(&EN_LESSAC)
            } else if voice_ready(voice_path, &RO_MIHAI) {
                Some(&RO_MIHAI)
            } else {
                None
            }
        }
        _ if voice_ready(voice_path, &EN_LESSAC) => Some(&EN_LESSAC),
        _ if voice_ready(voice_path, &RO_MIHAI) => Some(&RO_MIHAI),
        _ => None,
    }
}

fn piper_archive_name() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "piper_linux_x86_64.tar.gz"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "piper_linux_aarch64.tar.gz"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "piper_macos_aarch64.tar.gz"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "piper_macos_x64.tar.gz"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "piper_windows_amd64.zip"
    }
    #[cfg(not(any(
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    {
        "piper_linux_x86_64.tar.gz"
    }
}

pub async fn download_bytes(
    url: &str,
    dest: &Path,
    expected: Option<u64>,
    expected_md5: Option<&str>,
    mut on_progress: impl FnMut(u8),
) -> anyhow::Result<()> {
    use futures_util::StreamExt;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = dest.with_extension("download");
    let mut file = fs::File::create(&temp)?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(20))
        .build()?
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    let total_hint = expected.or_else(|| response.content_length()).unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut total = 0u64;
    let mut last = 0u8;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        total += chunk.len() as u64;
        if let Some(limit) = expected {
            if total > limit {
                anyhow::bail!("Download exceeded expected size.");
            }
        }
        file.write_all(&chunk)?;
        if total_hint > 0 {
            let percent = ((total * 100) / total_hint).min(100) as u8;
            if percent != last {
                last = percent;
                on_progress(percent);
            }
        }
    }
    drop(file);
    if let Some(limit) = expected {
        if total != limit {
            let _ = fs::remove_file(&temp);
            anyhow::bail!("Download size mismatch ({total} != {limit}).");
        }
    }
    if let Some(md5) = expected_md5 {
        if !valid_file(&temp, total, md5) {
            let _ = fs::remove_file(&temp);
            anyhow::bail!("Download checksum mismatch.");
        }
    }
    fs::rename(&temp, dest)?;
    on_progress(100);
    Ok(())
}

pub async fn download_voice_files(
    voice_path: &Path,
    spec: &VoiceSpec,
    mut on_progress: impl FnMut(u8),
) -> anyhow::Result<()> {
    let dir = voice_dir(voice_path, spec.id);
    fs::create_dir_all(&dir)?;
    let onnx = dir.join(format!("{}.onnx", spec.id));
    let json = dir.join(format!("{}.onnx.json", spec.id));
    if !voice_ready(voice_path, spec) {
        download_bytes(
            &format!("{HF_VOICE_BASE}/{}", spec.json_rel),
            &json,
            Some(spec.json_bytes),
            Some(spec.json_md5),
            |_| {},
        )
        .await?;
        download_bytes(
            &format!("{HF_VOICE_BASE}/{}", spec.onnx_rel),
            &onnx,
            Some(spec.onnx_bytes),
            Some(spec.onnx_md5),
            &mut on_progress,
        )
        .await?;
    } else {
        on_progress(100);
    }
    Ok(())
}

fn piper_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "piper.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "piper"
    }
}

/// Official archives ship `piper/piper` (+ libs). Find that binary under `dir`.
fn find_piper_binary(dir: &Path) -> Option<PathBuf> {
    let name = piper_binary_name();
    fn walk(dir: &Path, name: &str) -> Option<PathBuf> {
        let entries = fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = walk(&path, name) {
                    return Some(found);
                }
            } else if entry.file_name() == name {
                return Some(path);
            }
        }
        None
    }
    walk(dir, name)
}

/// Move the folder that contains the Piper binary to `dest` (`…/tts/piper`).
fn install_piper_tree(staging: &Path, dest: &Path) -> anyhow::Result<()> {
    let bin = find_piper_binary(staging).ok_or_else(|| {
        anyhow::anyhow!("Piper did not install correctly. Download it again.")
    })?;
    let source_root = bin
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Piper did not install correctly. Download it again."))?
        .to_path_buf();
    let _ = fs::remove_dir_all(dest);
    if source_root == staging {
        fs::create_dir_all(dest)?;
        for entry in fs::read_dir(staging)?.flatten() {
            fs::rename(entry.path(), dest.join(entry.file_name()))?;
        }
    } else {
        fs::rename(&source_root, dest)?;
    }
    if !dest.join(piper_binary_name()).is_file() {
        anyhow::bail!("Piper did not install correctly. Download it again.");
    }
    Ok(())
}

pub async fn download_piper_runtime(
    voice_path: &Path,
    mut on_progress: impl FnMut(u8),
) -> anyhow::Result<()> {
    if piper_ready(voice_path) {
        on_progress(100);
        return Ok(());
    }
    let root = tts_root(voice_path);
    fs::create_dir_all(&root)?;
    let archive_name = piper_archive_name();
    let archive = root.join(archive_name);
    let url = format!("{PIPER_RELEASE}/{archive_name}");
    download_bytes(&url, &archive, None, None, &mut on_progress).await?;
    // Extract to a staging dir, then place `piper/` where piper_bin() expects it.
    // Official tarballs already contain a top-level `piper/` folder; extracting
    // directly into `tts/piper` used to nest as `tts/piper/piper/piper` and the
    // old flatten step deleted the binary while leaving the shared libs behind.
    let staging = root.join(".piper-extract");
    let extract_dir = root.join("piper");
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&extract_dir);
    fs::create_dir_all(&staging)?;
    if let Err(error) = extract_archive(&archive, &staging) {
        let _ = fs::remove_file(&archive);
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = fs::remove_file(&archive);
    if let Err(error) = install_piper_tree(&staging, &extract_dir) {
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(error);
    }
    let _ = fs::remove_dir_all(&staging);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin = piper_bin(voice_path);
        if bin.is_file() {
            let mut perms = fs::metadata(&bin)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&bin, perms)?;
        }
    }
    if !piper_ready(voice_path) {
        let _ = fs::remove_dir_all(&extract_dir);
        anyhow::bail!("Piper did not install correctly. Download it again.");
    }
    on_progress(100);
    Ok(())
}

fn extract_archive(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                    archive.display(),
                    dest.display()
                ),
            ])
            .status()?;
        if !status.success() {
            anyhow::bail!("Could not unpack the Piper download.");
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("tar")
            .args(["-xzf", &archive.to_string_lossy(), "-C", &dest.to_string_lossy()])
            .status()?;
        if !status.success() {
            anyhow::bail!("Could not unpack the Piper download.");
        }
        Ok(())
    }
}

fn play_wav(path: &Path, stop: &AtomicBool) -> anyhow::Result<()> {
    let mut command = play_command(path).ok_or_else(|| {
        anyhow::anyhow!("No system audio player found to play Piper output.")
    })?;
    command.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut process = command.spawn()?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if stop.load(Ordering::Acquire) || Instant::now() >= deadline {
            let _ = process.kill();
            let _ = process.wait();
            break;
        }
        if let Some(result) = process.try_wait()? {
            if !result.success() {
                anyhow::bail!("Audio playback failed.");
            }
            break;
        }
        thread::sleep(Duration::from_millis(30));
    }
    Ok(())
}

fn play_command(path: &Path) -> Option<Command> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "(New-Object Media.SoundPlayer '{}').PlaySync()",
                path.display().to_string().replace('\'', "''")
            ),
        ]);
        return Some(command);
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/afplay");
        command.arg(path);
        return Some(command);
    }
    #[cfg(target_os = "linux")]
    {
        for name in ["paplay", "aplay", "ffplay"] {
            let found = std::env::var_os("PATH").is_some_and(|paths| {
                std::env::split_paths(&paths).any(|dir| dir.join(name).is_file())
            });
            if found {
                let mut command = Command::new(name);
                if name == "ffplay" {
                    command.args(["-nodisp", "-autoexit", "-loglevel", "quiet"]);
                }
                command.arg(path);
                return Some(command);
            }
        }
    }
    None
}

pub fn speak_piper(
    voice_path: &Path,
    language: &str,
    text: &str,
    stop: &AtomicBool,
) -> anyhow::Result<()> {
    let spec = pick_voice(voice_path, language)
        .ok_or_else(|| anyhow::anyhow!("Download Piper in Voice settings before spoken replies."))?;
    let bin = piper_bin(voice_path);
    if !bin.is_file() {
        anyhow::bail!("Download Piper in Voice settings before spoken replies.");
    }
    let dir = voice_dir(voice_path, spec.id);
    let model = dir.join(format!("{}.onnx", spec.id));
    let wav = voice_path.join("tts").join("reply.wav");
    let _ = fs::remove_file(&wav);
    let mut command = Command::new(&bin);
    command
        .current_dir(bin.parent().unwrap_or(voice_path))
        .args([
            "--model",
            &model.to_string_lossy(),
            "--output_file",
            &wav.to_string_lossy(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut process = command.spawn()?;
    if let Some(mut input) = process.stdin.take() {
        input.write_all(text.as_bytes())?;
    }
    let status = process.wait()?;
    if !status.success() {
        anyhow::bail!("Piper could not generate speech.");
    }
    if !wav.is_file() {
        anyhow::bail!("Piper produced no audio.");
    }
    let result = play_wav(&wav, stop);
    let _ = fs::remove_file(&wav);
    result
}
