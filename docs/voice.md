# Voice assistant

Settings → Voice enables the desktop assistant. It is disabled by default and
does not open the microphone until enabled. Download the multilingual local
recognition model once (~60 MB); its size and SHA-256 are verified before use.
After download, recognition works offline without an API key.

The assistant uses the system-default microphone. Audio is analyzed in memory on
this computer and is not saved or uploaded. Short noises and silence do not
trigger transcription. Only activated commands are displayed in the settings;
they are not persisted as a conversation history.

Supported commands:

- “Hey Azalea, wake up server [saved name]”
- “Hey Azalea, open Azalea”
- “Hey Azalea, status”
- “Hey Azalea” followed by a command within eight seconds

Wake-on-LAN uses hosts with configured MAC addresses in the active account.
Ambiguous names do not send packets. Without a name, exactly one configured
Wake-on-LAN host must exist. The voice assistant does not execute shell/SSH
commands and does not send requests to the terminal AI provider. Wake-on-LAN
requires the same network/firmware setup as the normal Wake action.

Closing the window keeps the process in the tray when the assistant and “Keep
Azalea in the system tray” are enabled. Open Azalea or disable listening from
the tray menu. **Quit Azalea** stops the process and microphone completely.
Relaunching the app focuses the existing window instead of starting a second
listener. This does not install an OS startup service.

Voice replies use Windows system speech, macOS `say`, or Linux `espeak-ng` /
`espeak`. DEB/RPM builds declare `espeak-ng`; AppImage users may need to install
it separately. Test the output device with “Test voice reply”. Microphone
permission and an available system tray are required for background operation.
Language and sensitivity can be changed in Voice settings. The recognition
language defaults to English; the Romanian mode is experimental. Choose Română
for Romanian commands or Automatic for detection. Selecting a language is faster
for short commands than automatic detection. Pause or disable listening before
discussing material you do not want analyzed locally.

Native builds need CMake and a C++ compiler; Linux also needs ALSA development
headers (`libasound2-dev` on Ubuntu or `alsa-lib-devel` on Fedora). The Linux
release workflow installs these dependencies for x64 and ARM64 builds. Speech
engine CPU flags are kept portable rather than tied to the CI runner's CPU.
Microphone/tray support is desktop-only. macOS builds target macOS 11.0 or
newer. The release workflow derives both `MACOSX_DEPLOYMENT_TARGET` and
`CMAKE_OSX_DEPLOYMENT_TARGET` from Tauri's configured minimum so the bundled
speech engine uses the same deployment baseline.
