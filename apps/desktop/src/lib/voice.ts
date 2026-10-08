import { invoke } from "@tauri-apps/api/core";

export interface VoicePreferences {
  enabled: boolean;
  keepInTray: boolean;
  voiceReplies: boolean;
  allowWakeOnLan: boolean;
  language: "auto" | "en" | "ro";
  sensitivity: number;
}

export interface VoiceStatus {
  preferences: VoicePreferences;
  phase: string;
  message: string;
  modelReady: boolean;
  downloadPercent: number;
  speechAvailable: boolean;
  trayAvailable: boolean;
  lastCommand: string | null;
  lastReply: string | null;
  replyError: string | null;
  microphone: string | null;
}

export const voiceStatus = () => invoke<VoiceStatus>("voice_status");
export const saveVoicePreferences = (preferences: VoicePreferences) =>
  invoke<VoiceStatus>("voice_set_preferences", { preferences });
export const downloadVoiceModel = () =>
  invoke<VoiceStatus>("voice_download_model");
export const restartVoice = () => invoke<VoiceStatus>("voice_restart");
export const testVoiceReply = () => invoke<void>("voice_test_reply");
