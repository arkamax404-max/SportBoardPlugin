"use strict";

// Host-computer score alert. The D200 has no audio output, so playback runs in
// a separate child process provided by the operating system and never blocks
// match rendering or polling.

const childProcess = require("node:child_process");
const nodePath = require("node:path");

const WINDOWS_SOUND_ENV = "SPORTBOARD_SCORE_SOUND";
const WINDOWS_SCRIPT = "([System.Media.SoundPlayer]::new([Environment]::GetEnvironmentVariable('SPORTBOARD_SCORE_SOUND'))).PlaySync()";
const MACOS_COMMAND = "/usr/bin/afplay";

function resolveWindowsPowerShellPath(env) {
  if (!env || typeof env !== "object") return null;
  const entries = Object.entries(env);
  for (const name of ["SYSTEMROOT", "WINDIR"]) {
    const value = entries.find(([key]) => key.toUpperCase() === name)?.[1];
    if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) continue;
    const root = value.trim();
    if (!nodePath.win32.isAbsolute(root) || nodePath.win32.parse(root).root === "\\") continue;
    return nodePath.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }
  return null;
}

function createScoreAlertPlayer({
  spawn = childProcess.spawn,
  platform = process.platform,
  soundPath = nodePath.join(__dirname, "..", "assets", "sounds", "score-change.wav"),
  env = process.env,
} = {}) {
  if (typeof spawn !== "function") throw new TypeError("spawn must be a function");
  const absoluteSoundPath = nodePath.isAbsolute(soundPath) ? soundPath : nodePath.resolve(soundPath);
  const active = new Set();
  let disposed = false;

  function play() {
    if (disposed) return false;
    let command;
    let args;
    let options = { shell: false, windowsHide: true, stdio: "ignore" };
    if (platform === "win32") {
      command = resolveWindowsPowerShellPath(env);
      if (command === null) return false;
      args = ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT];
      options = { ...options, env: { ...env, [WINDOWS_SOUND_ENV]: absoluteSoundPath } };
    } else if (platform === "darwin") {
      command = MACOS_COMMAND;
      args = [absoluteSoundPath];
    } else {
      return false;
    }

    try {
      const child = spawn(command, args, options);
      if (!child || typeof child.once !== "function") return false;
      active.add(child);
      const forget = () => active.delete(child);
      child.once("error", forget);
      child.once("close", forget);
      return true;
    } catch {
      return false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const child of active) {
      try {
        child.kill();
      } catch {
        // Process exit races are expected during shutdown.
      }
    }
    active.clear();
  }

  return { play, dispose };
}

module.exports = {
  MACOS_COMMAND,
  WINDOWS_SOUND_ENV,
  WINDOWS_SCRIPT,
  createScoreAlertPlayer,
  resolveWindowsPowerShellPath,
};
