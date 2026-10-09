# Voice assistant

Settings → Voice enables the desktop assistant. It is disabled by default and
does not open the microphone until enabled. Download the multilingual local
recognition model once (~60 MB); its size and SHA-256 are verified before use.
After download, recognition works offline without an API key.

Optionally download **Piper** for clearer spoken replies (~90 MB including the
runtime and one voice). Piper is preferred when present; otherwise Azalea uses
Windows system speech, macOS `say`, or Linux `espeak-ng` / `espeak`. DEB/RPM
builds still declare `espeak-ng` as a fallback; AppImage users may need to
install it separately if they skip Piper.

The assistant uses the system-default microphone. Audio is analyzed in memory on
this computer and is not saved or uploaded. Short noises and silence do not
trigger transcription. Only activated commands are displayed in the settings;
they are not persisted as a conversation history.

Supported commands:

- “Hey Azalea, wake up server [saved name]”
- “Hei Azalea, pornește serverul [numele salvat]”
- “Hey Azalea, open Azalea”
- “Hey Azalea, status”
- “Hey Azalea, ask ai [question]”
- “Hey Azalea” followed by a command within eight seconds

`ask ai` uses the provider already configured in Settings → AI (same API key).
If AI is off or no key is saved, Azalea opens Settings → AI and says so. The
voice worker does not run shell/SSH commands and does not use Agent mode or web
search.

Wake-on-LAN uses hosts with configured MAC addresses in the active account.
Ambiguous names do not send packets. Without a name, exactly one configured
Wake-on-LAN host must exist. Wake-on-LAN requires the same network/firmware
setup as the normal Wake action.

Closing the window keeps the process in the tray when the assistant and “Keep
Azalea in the system tray” are enabled. Open Azalea or disable listening from
the tray menu. **Quit Azalea** stops the process and microphone completely.
Relaunching the app focuses the existing window instead of starting a second
listener. This does not install an OS startup service.

Test the output device with “Test voice reply”. Microphone permission and an
available system tray are required for background operation. Language and
sensitivity can be changed in Voice settings. The recognition language defaults
to English; the Romanian mode is experimental. Choose Română for Romanian
commands or Automatic for detection. Selecting a language is faster for short
commands than automatic detection. Pause or disable listening before discussing
material you do not want analyzed locally.

Native builds need CMake and a C++ compiler; Linux also needs ALSA development
headers (`libasound2-dev` on Ubuntu or `alsa-lib-devel` on Fedora). The Linux
release workflow installs these dependencies for x64 and ARM64 builds. Speech
engine CPU flags are kept portable rather than tied to the CI runner's CPU.
Microphone/tray support is desktop-only. The Android APK does not include the
voice assistant.

macOS builds target macOS 11.0 or newer. The release workflow derives both
`MACOSX_DEPLOYMENT_TARGET` and `CMAKE_OSX_DEPLOYMENT_TARGET` from Tauri's
configured minimum so the bundled speech engine uses the same deployment
baseline.
