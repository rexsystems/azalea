mod intent;
mod tts;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use intent::Intent;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin";
const MODEL_HASH: &str = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898";
const MODEL_BYTES: u64 = 59_707_625;
const MODEL_FILE: &str = "ggml-base-q5_1.bin";
const VOCABULARY: &str =
    "Hey Azalea. Voice commands: wake up server, open Azalea, status, ask ai.";
const VOCABULARY_RO: &str =
    "Hei Azalea. Comenzi vocale: pornește serverul, deschide Azalea, status, întreabă.";

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub enabled: bool,
    pub keep_in_tray: bool,
    pub voice_replies: bool,
    pub allow_wake_on_lan: bool,
    pub language: String,
    pub sensitivity: f32,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            keep_in_tray: true,
            voice_replies: true,
            allow_wake_on_lan: true,
            language: "en".into(),
            sensitivity: 0.012,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    preferences: Preferences,
    phase: String,
    message: String,
    model_ready: bool,
    download_percent: u8,
    tts_ready: bool,
    tts_download_percent: u8,
    speech_available: bool,
    tray_available: bool,
    last_command: Option<String>,
    last_reply: Option<String>,
    reply_error: Option<String>,
    microphone: Option<String>,
}

struct Worker {
    stop: Arc<AtomicBool>,
    thread: thread::JoinHandle<()>,
}
struct Inner {
    path: PathBuf,
    preferences: Mutex<Preferences>,
    status: Mutex<Status>,
    operation: Mutex<()>,
    worker: Mutex<Option<Worker>>,
    speaking: AtomicBool,
    downloading: AtomicBool,
}

#[derive(Clone)]
pub struct VoiceAssistant(Arc<Inner>);

impl VoiceAssistant {
    pub fn new(app: &tauri::AppHandle) -> anyhow::Result<Self> {
        whisper_rs::install_logging_hooks();
        let path = app.path().app_data_dir()?.join("voice");
        let preferences = fs::read(path.join("preferences.json"))
            .ok()
            .and_then(|data| serde_json::from_slice::<Preferences>(&data).ok())
            .unwrap_or_default();
        let ready = valid_model(&path.join(MODEL_FILE));
        let tts_ready = tts::any_tts_ready(&path);
        let status = Status {
            preferences: preferences.clone(),
            phase: "off".into(),
            message: "Voice assistant is disabled.".into(),
            model_ready: ready,
            download_percent: 0,
            tts_ready,
            tts_download_percent: 0,
            speech_available: speech_command().is_some() || tts_ready,
            tray_available: false,
            last_command: None,
            last_reply: None,
            reply_error: None,
            microphone: None,
        };
        Ok(Self(Arc::new(Inner {
            path,
            preferences: Mutex::new(preferences),
            status: Mutex::new(status),
            operation: Mutex::new(()),
            worker: Mutex::new(None),
            speaking: AtomicBool::new(false),
            downloading: AtomicBool::new(false),
        })))
    }

    pub fn snapshot(&self) -> Status {
        let mut status = self.0.status.lock().clone();
        status.preferences = self.0.preferences.lock().clone();
        status.tts_ready = tts::any_tts_ready(&self.0.path);
        status.speech_available = speech_command().is_some() || status.tts_ready;
        status
    }

    fn publish(&self, app: &tauri::AppHandle, phase: &str, message: &str) {
        {
            let mut status = self.0.status.lock();
            status.phase = phase.into();
            status.message = message.into();
        }
        let _ = app.emit("azalea-voice-status", self.snapshot());
    }

    pub fn keep_in_tray(&self) -> bool {
        let prefs = self.0.preferences.lock();
        prefs.enabled && prefs.keep_in_tray && self.0.status.lock().tray_available
    }

    pub fn signal_stop(&self) {
        if let Some(worker) = self.0.worker.lock().as_ref() {
            worker.stop.store(true, Ordering::Release);
        }
    }

    fn stop(&self) {
        let worker = self.0.worker.lock().take();
        if let Some(worker) = worker {
            worker.stop.store(true, Ordering::Release);
            let _ = worker.thread.join();
        }
    }

    pub fn restart(&self, app: tauri::AppHandle) {
        let _operation = self.0.operation.lock();
        self.start(app);
    }

    fn start(&self, app: tauri::AppHandle) {
        self.stop();
        let preferences = self.0.preferences.lock().clone();
        if !preferences.enabled {
            self.publish(&app, "off", "Microphone is off.");
            return;
        }
        let model_ready = valid_model(&self.0.path.join(MODEL_FILE));
        self.0.status.lock().model_ready = model_ready;
        if !model_ready {
            self.publish(
                &app,
                "error",
                "Download the local speech model before enabling voice recognition.",
            );
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let assistant = self.clone();
        self.publish(&app, "starting", "Starting local voice recognition…");
        let thread = thread::spawn(move || {
            let result = assistant.listen(&app, &preferences, &thread_stop);
            if let Err(error) = result {
                if !thread_stop.load(Ordering::Acquire) {
                    assistant.publish(&app, "error", &error.to_string());
                }
            }
        });
        *self.0.worker.lock() = Some(Worker { stop, thread });
    }

    fn save(&self, app: tauri::AppHandle, preferences: Preferences) -> Result<Status, String> {
        if !["auto", "en", "ro"].contains(&preferences.language.as_str())
            || !preferences.sensitivity.is_finite()
            || !(0.003..=0.06).contains(&preferences.sensitivity)
        {
            return Err("Invalid voice recognition settings.".into());
        }
        if preferences.enabled && !self.0.status.lock().model_ready {
            return Err("Download the local speech model first.".into());
        }
        let _operation = self.0.operation.lock();
        fs::create_dir_all(&self.0.path).map_err(|error| error.to_string())?;
        let temporary = self.0.path.join("preferences.pending.json");
        fs::write(
            &temporary,
            serde_json::to_vec(&preferences).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::rename(temporary, self.0.path.join("preferences.json"))
            .map_err(|error| error.to_string())?;
        *self.0.preferences.lock() = preferences.clone();
        self.0.status.lock().reply_error = None;
        if let Some(tray) = app.tray_by_id("azalea-voice") {
            let _ = tray.set_visible(preferences.enabled);
        }
        if !preferences.enabled {
            show_main(&app);
        }
        self.start(app);
        Ok(self.snapshot())
    }

    fn listen(
        &self,
        app: &tauri::AppHandle,
        preferences: &Preferences,
        stop: &Arc<AtomicBool>,
    ) -> anyhow::Result<()> {
        let model = self.0.path.join(MODEL_FILE);
        let mut context_params = WhisperContextParameters::default();
        context_params.use_gpu(false);
        let context =
            WhisperContext::new_with_params(model.to_string_lossy().as_ref(), context_params)?;
        if stop.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut decoder = context.create_state()?;
        let device = cpal::default_host().default_input_device().ok_or_else(|| {
            anyhow::anyhow!("No microphone found. Connect a microphone and restart listening.")
        })?;
        let supported = device.default_input_config()?;
        let rate = supported.sample_rate() as usize;
        let channels = supported.channels() as usize;
        if rate == 0 || channels == 0 {
            anyhow::bail!("The microphone reported an invalid audio format.");
        }
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let samples = Arc::new(Mutex::new(VecDeque::<f32>::new()));
        let audio_error = Arc::new(Mutex::new(None::<String>));
        macro_rules! input_stream {
            ($sample:ty, $convert:expr) => {{
                let buffer = samples.clone(); let assistant = self.clone(); let capture_stop = stop.clone(); let errors = audio_error.clone();
                device.build_input_stream(config, move |data: &[$sample], _| {
                    if capture_stop.load(Ordering::Acquire) || assistant.0.speaking.load(Ordering::Acquire) { return; }
                    if let Some(mut queue) = buffer.try_lock() {
                        for frame in data.chunks(channels) { queue.push_back(frame.iter().map($convert).sum::<f32>() / frame.len() as f32); }
                        while queue.len() > rate * 10 { queue.pop_front(); }
                    }
                }, move |error| { *errors.lock() = Some(format!("Microphone error: {error}. Restart listening after checking its permissions.")); }, Some(Duration::from_secs(5)))?
            }};
        }
        let stream = match format {
            cpal::SampleFormat::F32 => input_stream!(f32, |sample: &f32| *sample),
            cpal::SampleFormat::I16 => input_stream!(i16, |sample: &i16| *sample as f32 / 32768.0),
            cpal::SampleFormat::U16 => input_stream!(u16, |sample: &u16| (*sample as f32 - 32768.0) / 32768.0),
            cpal::SampleFormat::F64 => input_stream!(f64, sample_float::<f64>),
            cpal::SampleFormat::I8 => input_stream!(i8, sample_float::<i8>),
            cpal::SampleFormat::I24 => input_stream!(cpal::I24, sample_float::<cpal::I24>),
            cpal::SampleFormat::I32 => input_stream!(i32, sample_float::<i32>),
            cpal::SampleFormat::I64 => input_stream!(i64, sample_float::<i64>),
            cpal::SampleFormat::U8 => input_stream!(u8, sample_float::<u8>),
            cpal::SampleFormat::U24 => input_stream!(cpal::U24, sample_float::<cpal::U24>),
            cpal::SampleFormat::U32 => input_stream!(u32, sample_float::<u32>),
            cpal::SampleFormat::U64 => input_stream!(u64, sample_float::<u64>),
            _ => anyhow::bail!("The default microphone format is unsupported. Choose another system-default input device."),
        };
        self.0.status.lock().microphone = Some(device.to_string());
        stream.play()?;
        self.publish(app, "listening", "Listening locally for Hey Azalea.");
        let mut speech = SpeechBuffer::new(rate, preferences.sensitivity);
        let mut armed_until = Instant::now();
        let mut armed_account: Option<String> = None;
        let language = if preferences.language == "auto" {
            None
        } else {
            Some(preferences.language.as_str())
        };
        let mut cached_vocabulary = vocabulary(&preferences.language, &[]);
        let mut params = recognition_params(language, &cached_vocabulary, stop.as_ref());
        while !stop.load(Ordering::Acquire) {
            if self.0.speaking.load(Ordering::Acquire) {
                samples.lock().clear();
                speech.clear();
                thread::sleep(Duration::from_millis(40));
                continue;
            }
            if let Some(error) = audio_error.lock().take() {
                anyhow::bail!(error);
            }
            let chunk: Vec<f32> = samples.lock().drain(..).collect();
            if let Some(utterance) = speech.push(&chunk) {
                let account_id = app
                    .state::<crate::commands::accounts::SharedAccountRegistry>()
                    .lock()
                    .active_id()
                    .to_owned();
                let armed = Instant::now() < armed_until
                    && armed_account.as_deref() == Some(account_id.as_str());
                let vocabulary = vocabulary_for_account(app, &preferences.language, &account_id);
                self.publish(app, "recognizing", "Recognizing speech locally…");
                let audio = resample(&utterance, rate, 16000);
                if vocabulary != cached_vocabulary {
                    params.set_initial_prompt(&vocabulary);
                    cached_vocabulary = vocabulary;
                }
                if let Err(error) = decoder.full(params.clone(), &audio) {
                    if stop.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    anyhow::bail!("Local speech recognition failed: {error}. Restart listening.");
                }
                if !stop.load(Ordering::Acquire) {
                    let text = decoder
                        .as_iter()
                        .filter_map(|segment| segment.to_str().ok().map(str::to_owned))
                        .collect::<Vec<_>>()
                        .join(" ");
                    if let Some(intent) = intent::parse(&text, armed) {
                        self.0.status.lock().last_command = Some(text.chars().take(256).collect());
                        let arm = intent == Intent::Arm;
                        if matches!(intent, Intent::AskAi(_)) {
                            self.publish(app, "thinking", "Asking AI…");
                        }
                        let reply =
                            execute(app, intent, preferences.allow_wake_on_lan, &account_id);
                        self.0.status.lock().last_reply = Some(reply.clone());
                        if preferences.voice_replies {
                            self.publish(app, "speaking", &reply);
                            self.0.status.lock().reply_error = self
                                .speak(&reply, &preferences.language, stop)
                                .err()
                                .map(|error| error.to_string());
                        }
                        armed_until = if arm {
                            Instant::now() + Duration::from_secs(8)
                        } else {
                            Instant::now()
                        };
                        armed_account = arm.then(|| account_id.clone());
                    }
                }
                samples.lock().clear();
                speech.clear();
                if !stop.load(Ordering::Acquire) {
                    self.publish(app, "listening", "Listening locally for Hey Azalea.");
                }
            }
            thread::sleep(Duration::from_millis(40));
        }
        drop(stream);
        Ok(())
    }

    fn speak(&self, text: &str, language: &str, stop: &AtomicBool) -> anyhow::Result<()> {
        let text: String = text.chars().take(512).collect();
        if self.0.speaking.swap(true, Ordering::AcqRel) {
            anyhow::bail!("A voice reply is already playing.");
        }
        struct Speaking<'a>(&'a AtomicBool);
        impl Drop for Speaking<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _speaking = Speaking(&self.0.speaking);
        if tts::any_tts_ready(&self.0.path) {
            match tts::speak_piper(&self.0.path, language, &text, stop) {
                Ok(()) => {
                    thread::sleep(Duration::from_millis(250));
                    return Ok(());
                }
                Err(error) => {
                    eprintln!("Piper TTS failed, falling back to system speech: {error}");
                }
            }
        }
        let mut command = speech_command().ok_or_else(|| {
            anyhow::anyhow!(
                "Download Piper in Voice settings, or install espeak-ng for system speech on Linux."
            )
        })?;
        command
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
            if let Err(error) = input.write_all(text.as_bytes()) {
                let _ = process.kill();
                let _ = process.wait();
                return Err(error.into());
            }
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if stop.load(Ordering::Acquire) || Instant::now() >= deadline {
                let _ = process.kill();
                let _ = process.wait();
                break;
            }
            if let Some(result) = process.try_wait()? {
                if !result.success() {
                    anyhow::bail!("System speech output failed. Check the output device and installed voices.");
                }
                break;
            }
            thread::sleep(Duration::from_millis(30));
        }
        thread::sleep(Duration::from_millis(250));
        Ok(())
    }
}

unsafe extern "C" fn abort_recognition(data: *mut std::ffi::c_void) -> bool {
    if data.is_null() {
        return true;
    }
    // The worker owns this AtomicBool until the synchronous decoder call returns.
    unsafe { (*(data as *const AtomicBool)).load(Ordering::Acquire) }
}

fn recognition_params<'a>(
    language: Option<&'a str>,
    vocabulary: &str,
    stop: &'a AtomicBool,
) -> FullParams<'a, 'static> {
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 3,
        patience: -1.0,
    });
    params.set_n_threads(
        thread::available_parallelism()
            .map(|count| count.get().min(4))
            .unwrap_or(2) as i32,
    );
    params.set_language(language);
    params.set_initial_prompt(vocabulary);
    params.set_audio_ctx(512);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_print_special(false);
    params.set_no_context(true);
    params.set_no_timestamps(true);
    params.set_single_segment(true);
    params.set_max_tokens(96);
    unsafe {
        params.set_abort_callback(Some(abort_recognition));
        params.set_abort_callback_user_data(stop as *const AtomicBool as *mut std::ffi::c_void);
    }
    params
}

fn sample_float<T: cpal::Sample>(sample: &T) -> f32
where
    f32: cpal::FromSample<T>,
{
    cpal::Sample::to_sample::<f32>(*sample)
}

fn valid_model(path: &PathBuf) -> bool {
    if fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) != MODEL_BYTES {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => hash.update(&buffer[..count]),
            Err(_) => return false,
        }
    }
    hex::encode(hash.finalize()) == MODEL_HASH
}

fn speech_command() -> Option<Command> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $azaleaSpeaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; $azaleaSpeaker.Speak([Console]::In.ReadToEnd())"]);
        return Some(command);
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/say");
        command.args(["-f", "-"]);
        return Some(command);
    }
    #[cfg(target_os = "linux")]
    {
        for name in ["espeak-ng", "espeak"] {
            let found = std::env::var_os("PATH").is_some_and(|paths| {
                std::env::split_paths(&paths).any(|path| path.join(name).is_file())
            });
            if found {
                let mut command = Command::new(name);
                command.arg("--stdin");
                return Some(command);
            }
        }
    }
    None
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn vocabulary(language: &str, names: &[String]) -> String {
    let base = if language == "ro" {
        VOCABULARY_RO
    } else {
        VOCABULARY
    };
    if names.is_empty() {
        return base.into();
    }
    let names = names
        .iter()
        .take(32)
        .map(|name| intent::normalize(name).chars().take(60).collect::<String>())
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{base} {}: {names}.",
        if language == "ro" {
            "Servere salvate"
        } else {
            "Saved servers"
        }
    )
}

fn vocabulary_for_account(app: &tauri::AppHandle, language: &str, account_id: &str) -> String {
    let names = (|| -> anyhow::Result<Vec<String>> {
        let registry = app.state::<crate::commands::accounts::SharedAccountRegistry>();
        let registry = registry.lock();
        if registry.active_id() != account_id { return Ok(Vec::new()); }
        let path = crate::store::accounts::account_db_path(app, account_id)?;
        let connection = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.busy_timeout(Duration::from_millis(100))?;
        let mut statement = connection.prepare("SELECT name FROM hosts WHERE mac_address IS NOT NULL AND trim(mac_address) != '' LIMIT 32")?;
        let names = statement.query_map([], |row| row.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(names)
    })().unwrap_or_default();
    vocabulary(language, &names)
}

fn execute(app: &tauri::AppHandle, intent: Intent, allow_wake: bool, account_id: &str) -> String {
    match intent {
        Intent::Arm => "I'm listening. Which server would you like to wake?".into(),
        Intent::Show => {
            show_main(app);
            "Azalea is open.".into()
        }
        Intent::Status => "I'm here and listening locally.".into(),
        Intent::Help | Intent::Unknown => {
            "I can wake a saved server, open Azalea, tell you my status, or ask AI a question."
                .into()
        }
        Intent::AskAi(question) => {
            show_main(app);
            crate::commands::ai::run_voice_chat(app, &question)
        }
        Intent::Wake(_) if !allow_wake => {
            "Wake-on-LAN voice commands are disabled in settings.".into()
        }
        Intent::Wake(name) => {
            wake_saved_host(app, &name, account_id).unwrap_or_else(|error| error.to_string())
        }
    }
}

fn wake_saved_host(app: &tauri::AppHandle, name: &str, account_id: &str) -> anyhow::Result<String> {
    let registry = app.state::<crate::commands::accounts::SharedAccountRegistry>();
    let registry = registry.lock();
    if registry.active_id() != account_id {
        anyhow::bail!("The active account changed. Say the command again for the current account.");
    }
    let account = registry
        .active()
        .ok_or_else(|| anyhow::anyhow!("Choose an account first."))?;
    let path = crate::store::accounts::account_db_path(app, &account.id)?;
    let connection =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.busy_timeout(Duration::from_millis(500))?;
    let mut query = connection.prepare("SELECT name, hostname, mac_address FROM hosts WHERE mac_address IS NOT NULL AND trim(mac_address) != ''")?;
    let hosts: Vec<(String, String, String)> = query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let matches: Vec<_> = hosts
        .iter()
        .filter(|host| {
            name.is_empty()
                || intent::normalize(&host.0) == name
                || intent::normalize(&host.1) == name
        })
        .collect();
    if matches.len() != 1 {
        anyhow::bail!(if matches.is_empty() {
            "No matching saved server has a Wake-on-LAN MAC address."
        } else {
            "More than one server matches. Say the exact saved server name."
        });
    }
    let host = matches[0];
    crate::commands::wol::send_wake_on_lan(&host.2, None)?;
    Ok(format!(
        "Wake request sent to {}.",
        host.0.chars().take(120).collect::<String>()
    ))
}

struct SpeechBuffer {
    rate: usize,
    threshold: f32,
    before: VecDeque<f32>,
    speech: Vec<f32>,
    quiet: usize,
    voiced: usize,
}
impl SpeechBuffer {
    fn new(rate: usize, threshold: f32) -> Self {
        Self {
            rate,
            threshold,
            before: VecDeque::new(),
            speech: Vec::new(),
            quiet: 0,
            voiced: 0,
        }
    }
    fn clear(&mut self) {
        self.before.clear();
        self.speech.clear();
        self.quiet = 0;
        self.voiced = 0;
    }
    fn push(&mut self, samples: &[f32]) -> Option<Vec<f32>> {
        if samples.is_empty() {
            return None;
        }
        let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>()
            / samples.len() as f32)
            .sqrt();
        if self.speech.is_empty() && rms < self.threshold {
            self.before.extend(samples);
            while self.before.len() > self.rate / 2 {
                self.before.pop_front();
            }
            return None;
        }
        if self.speech.is_empty() {
            self.speech.extend(self.before.drain(..));
        }
        self.speech.extend_from_slice(samples);
        if rms >= self.threshold {
            self.voiced += samples.len();
        }
        self.quiet = if rms >= self.threshold {
            0
        } else {
            self.quiet + samples.len()
        };
        if self.quiet >= self.rate * 3 / 5 || self.speech.len() >= self.rate * 8 {
            let speech = std::mem::take(&mut self.speech);
            self.quiet = 0;
            let voiced = std::mem::take(&mut self.voiced);
            return (voiced >= self.rate / 3 && speech.len() > self.rate * 3 / 4).then_some(speech);
        }
        None
    }
}

fn resample(samples: &[f32], source: usize, target: usize) -> Vec<f32> {
    if samples.is_empty() || source == 0 {
        return Vec::new();
    }
    (0..samples.len() * target / source)
        .map(|index| {
            let position = index as f64 * source as f64 / target as f64;
            let start = position as usize;
            let fraction = (position - start as f64) as f32;
            samples[start] * (1.0 - fraction)
                + samples[(start + 1).min(samples.len() - 1)] * fraction
        })
        .collect()
}

#[tauri::command]
pub fn voice_status(voice: tauri::State<'_, VoiceAssistant>) -> Status {
    voice.snapshot()
}

#[tauri::command]
pub async fn voice_set_preferences(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceAssistant>,
    preferences: Preferences,
) -> Result<Status, String> {
    let assistant = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || assistant.save(app, preferences))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn voice_restart(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceAssistant>,
) -> Result<Status, String> {
    let assistant = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        assistant.restart(app);
        assistant.snapshot()
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn voice_test_reply(voice: tauri::State<'_, VoiceAssistant>) -> Result<(), String> {
    let assistant = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let language = assistant.0.preferences.lock().language.clone();
        assistant
            .speak(
                "Azalea is ready. Voice replies are working.",
                &language,
                &AtomicBool::new(false),
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn voice_download_tts(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceAssistant>,
) -> Result<Status, String> {
    let assistant = voice.inner().clone();
    if assistant.0.downloading.swap(true, Ordering::AcqRel) {
        return Err("A model download is already in progress.".into());
    }
    struct Download(VoiceAssistant);
    impl Drop for Download {
        fn drop(&mut self) {
            self.0 .0.downloading.store(false, Ordering::Release);
        }
    }
    let _download = Download(assistant.clone());
    assistant.0.status.lock().tts_download_percent = 0;
    assistant.publish(
        &app,
        "downloading",
        "Downloading Piper voice and runtime (~90 MB)…",
    );
    let language = assistant.0.preferences.lock().language.clone();
    let spec = if language == "ro" {
        &tts::RO_MIHAI
    } else {
        &tts::EN_LESSAC
    };
    let path = assistant.0.path.clone();
    let result: anyhow::Result<()> = async {
        tts::download_piper_runtime(&path, |percent| {
            assistant.0.status.lock().tts_download_percent = percent.saturating_div(2);
            let _ = app.emit("azalea-voice-status", assistant.snapshot());
        })
        .await?;
        tts::download_voice_files(&path, spec, |percent| {
            let mapped = 50 + percent.saturating_div(2);
            assistant.0.status.lock().tts_download_percent = mapped;
            let _ = app.emit("azalea-voice-status", assistant.snapshot());
        })
        .await?;
        // Also ensure EN exists as fallback when downloading RO.
        if spec.id == tts::RO_MIHAI.id && !tts::voice_ready(&path, &tts::EN_LESSAC) {
            tts::download_voice_files(&path, &tts::EN_LESSAC, |_| {}).await?;
        }
        Ok(())
    }
    .await;
    match result {
        Ok(()) => {
            let ready = tts::any_tts_ready(&assistant.0.path);
            {
                let mut status = assistant.0.status.lock();
                status.tts_ready = ready;
                status.tts_download_percent = 100;
                status.speech_available = speech_command().is_some() || ready;
            }
            assistant.publish(
                &app,
                if assistant.0.preferences.lock().enabled {
                    "listening"
                } else {
                    "off"
                },
                if ready {
                    "Piper voice is ready."
                } else {
                    "Piper download finished, but files are incomplete."
                },
            );
            if assistant.0.preferences.lock().enabled {
                assistant.restart(app.clone());
            }
            Ok(assistant.snapshot())
        }
        Err(error) => {
            assistant.publish(&app, "error", &error.to_string());
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn voice_download_model(
    app: tauri::AppHandle,
    voice: tauri::State<'_, VoiceAssistant>,
) -> Result<Status, String> {
    use futures_util::StreamExt;
    let assistant = voice.inner().clone();
    if assistant.0.downloading.swap(true, Ordering::AcqRel) {
        return Err("A model download is already in progress.".into());
    }
    struct Download(VoiceAssistant);
    impl Drop for Download {
        fn drop(&mut self) {
            self.0 .0.downloading.store(false, Ordering::Release);
        }
    }
    let _download = Download(assistant.clone());
    assistant.0.status.lock().download_percent = 0;
    assistant.publish(
        &app,
        "downloading",
        "Downloading the local speech model (~60 MB)…",
    );
    let result: anyhow::Result<()> = async {
        fs::create_dir_all(&assistant.0.path)?;
        let path = assistant.0.path.join("model.download");
        let mut file = fs::File::create(&path)?;
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(20))
            .build()?
            .get(MODEL_URL)
            .send()
            .await?
            .error_for_status()?;
        let mut stream = response.bytes_stream();
        let mut total = 0u64;
        let mut last = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            total += chunk.len() as u64;
            if total > MODEL_BYTES {
                anyhow::bail!("The speech model download exceeded its expected size.");
            }
            file.write_all(&chunk)?;
            let percent = (total * 100 / MODEL_BYTES) as u8;
            if percent != last {
                assistant.0.status.lock().download_percent = percent;
                let _ = app.emit("azalea-voice-status", assistant.snapshot());
                last = percent;
            }
        }
        file.sync_all()?;
        drop(file);
        if !valid_model(&path) {
            anyhow::bail!("Speech model integrity check failed. Download it again.");
        }
        fs::rename(path, assistant.0.path.join(MODEL_FILE))?;
        assistant.0.status.lock().model_ready = true;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => {
            if assistant.0.preferences.lock().enabled {
                let worker = assistant.clone();
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || worker.restart(app))
                    .await
                    .map_err(|error| error.to_string())?;
            } else {
                assistant.publish(
                    &app,
                    "off",
                    "Local speech model ready. Enable the assistant to start listening.",
                );
            }
            Ok(assistant.snapshot())
        }
        Err(error) => {
            assistant.publish(&app, "error", &error.to_string());
            Err(error.to_string())
        }
    }
}

pub fn setup_tray(app: &tauri::AppHandle, voice: &VoiceAssistant) -> anyhow::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let show = MenuItem::with_id(app, "show", "Open Azalea", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Disable voice assistant", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Azalea", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pause, &quit])?;
    let mut builder = TrayIconBuilder::with_id("azalea-voice")
        .menu(&menu)
        .tooltip("Azalea voice assistant")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "pause" => {
                let voice = app.state::<VoiceAssistant>().inner().clone();
                let mut preferences = voice.0.preferences.lock().clone();
                preferences.enabled = false;
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = voice.save(app, preferences);
                });
            }
            "quit" => {
                app.state::<VoiceAssistant>().signal_stop();
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    tray.set_visible(voice.0.preferences.lock().enabled)?;
    voice.0.status.lock().tray_available = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disabled_by_default_and_silence_never_runs_recognition() {
        assert!(!Preferences::default().enabled);
        let mut buffer = SpeechBuffer::new(16000, 0.012);
        for _ in 0..100 {
            assert!(buffer.push(&vec![0.0001; 1600]).is_none());
        }
        assert!(buffer.before.len() <= 8000);
        assert!(buffer.speech.is_empty());
    }
    #[test]
    fn speech_ends_after_silence_and_resamples_without_changing_duration() {
        let mut buffer = SpeechBuffer::new(48000, 0.012);
        assert!(buffer.push(&vec![0.1; 48000]).is_none());
        let speech = buffer.push(&vec![0.0; 28800]).unwrap();
        assert_eq!(resample(&speech, 48000, 16000).len(), 25600);
        assert!(buffer.speech.is_empty());
    }

    #[test]
    #[ignore = "requires explicitly supplied synthetic audio and downloaded local model"]
    fn recognizes_synthetic_wake_command_without_a_microphone() {
        whisper_rs::install_logging_hooks();
        let model = PathBuf::from(std::env::var("AZALEA_TEST_VOICE_MODEL").unwrap());
        assert!(valid_model(&model));
        let wave = fs::read(std::env::var("AZALEA_TEST_VOICE_WAV").unwrap()).unwrap();
        assert_eq!(&wave[..4], b"RIFF");
        let mut position = 12usize;
        let mut rate = 0usize;
        let mut samples = Vec::new();
        while position + 8 <= wave.len() {
            let size =
                u32::from_le_bytes(wave[position + 4..position + 8].try_into().unwrap()) as usize;
            let chunk = &wave[position + 8..position + 8 + size];
            match &wave[position..position + 4] {
                b"fmt " => {
                    assert_eq!(u16::from_le_bytes(chunk[..2].try_into().unwrap()), 1);
                    assert_eq!(u16::from_le_bytes(chunk[2..4].try_into().unwrap()), 1);
                    assert_eq!(u16::from_le_bytes(chunk[14..16].try_into().unwrap()), 16);
                    rate = u32::from_le_bytes(chunk[4..8].try_into().unwrap()) as usize;
                }
                b"data" => {
                    samples = chunk
                        .chunks_exact(2)
                        .map(|bytes| i16::from_le_bytes(bytes.try_into().unwrap()) as f32 / 32768.0)
                        .collect();
                }
                _ => {}
            }
            position += 8 + size + size % 2;
        }
        let mut parameters = WhisperContextParameters::default();
        parameters.use_gpu(false);
        let context =
            WhisperContext::new_with_params(model.to_string_lossy().as_ref(), parameters).unwrap();
        let mut state = context.create_state().unwrap();
        let language = std::env::var("AZALEA_TEST_VOICE_LANGUAGE").ok();
        let vocabulary = vocabulary(language.as_deref().unwrap_or("en"), &["alpha".into()]);
        let stop = AtomicBool::new(false);
        let params = recognition_params(language.as_deref(), &vocabulary, &stop);
        state
            .full(params, &resample(&samples, rate, 16000))
            .unwrap();
        let text = state
            .as_iter()
            .map(|segment| segment.to_str().unwrap().to_owned())
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(
            intent::parse(&text, false),
            Some(Intent::Wake("alpha".into())),
            "Recognized: {text}"
        );
        stop.store(true, Ordering::Release);
        let stopped = recognition_params(language.as_deref(), &vocabulary, &stop);
        assert!(
            state
                .full(stopped, &resample(&samples, rate, 16000))
                .is_err(),
            "Stop must cancel native decoding"
        );
    }
}
