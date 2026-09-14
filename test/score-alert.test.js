"use strict";

const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  MACOS_COMMAND,
  WINDOWS_SOUND_ENV,
  WINDOWS_SCRIPT,
  createScoreAlertPlayer,
  resolveWindowsPowerShellPath,
} = require("../src/plugin/score-alert.js");

function spawnHarness() {
  const calls = [];
  const children = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.kills = 0;
    child.kill = () => { child.kills += 1; };
    calls.push({ command, args, options });
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

test("Windows playback uses an absolute trusted command and a child-only sound environment variable", () => {
  const h = spawnHarness();
  const soundPath = "C:\\Program Files\\Sport Board\\score-change.wav";
  const env = { SystemRoot: "C:\\Windows", PATH: "C:\\tools" };
  const player = createScoreAlertPlayer({ spawn: h.spawn, platform: "win32", soundPath, env });
  assert.equal(player.play(), true);
  assert.equal(h.calls[0].command, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.ok(nodePath.win32.isAbsolute(h.calls[0].command));
  assert.deepEqual(h.calls[0].args, ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT]);
  assert.doesNotMatch(JSON.stringify(h.calls[0].args), /score-change|Sport Board|Program Files/);
  assert.match(WINDOWS_SCRIPT, /GetEnvironmentVariable\('SPORTBOARD_SCORE_SOUND'\)/);
  assert.deepEqual(h.calls[0].options, {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
    env: { ...env, [WINDOWS_SOUND_ENV]: soundPath },
  });
  assert.equal(env[WINDOWS_SOUND_ENV], undefined, "the injected parent environment is not mutated");
});

test("macOS playback uses afplay directly without a shell", () => {
  const h = spawnHarness();
  const soundPath = "/Applications/Ulanzi/plugins/SportBoard/assets/sounds/score-change.wav";
  const player = createScoreAlertPlayer({ spawn: h.spawn, platform: "darwin", soundPath });
  assert.equal(player.play(), true);
  assert.deepEqual(h.calls[0], {
    command: MACOS_COMMAND,
    args: [soundPath],
    options: { shell: false, windowsHide: true, stdio: "ignore" },
  });
});

test("unsupported platforms and spawn failures degrade without throwing", () => {
  const unsupported = createScoreAlertPlayer({ spawn: () => { throw new Error("must not run"); }, platform: "linux" });
  assert.equal(unsupported.play(), false);
  const failed = createScoreAlertPlayer({
    spawn: () => { throw new Error("missing player"); },
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
  });
  assert.equal(failed.play(), false);
});

test("Windows playback does not spawn when SystemRoot and WINDIR are missing or invalid", () => {
  const h = spawnHarness();
  for (const env of [{ PATH: "C:\\tools" }, { SystemRoot: "relative\\Windows" }, { WINDIR: "" }]) {
    const player = createScoreAlertPlayer({ spawn: h.spawn, platform: "win32", env });
    assert.equal(player.play(), false);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(resolveWindowsPowerShellPath({ WINDIR: "D:\\Windows" }), "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});

test("Windows PowerShell parses the production script without executing it", (t) => {
  const command = resolveWindowsPowerShellPath(process.env);
  if (command === null || !nodeFs.existsSync(command)) {
    t.skip("Windows PowerShell is unavailable");
    return;
  }
  const parserScript = "$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Environment]::GetEnvironmentVariable('SPORTBOARD_SCRIPT'), [ref]$tokens, [ref]$errors); if ($errors.Count -ne 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }";
  const result = spawnSync(command, ["-NoProfile", "-NonInteractive", "-Command", parserScript], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, SPORTBOARD_SCRIPT: WINDOWS_SCRIPT },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /UnexpectedToken|Unexpected token/i);
});

test("dispose is idempotent, kills active playback, and disables future playback", () => {
  const h = spawnHarness();
  const player = createScoreAlertPlayer({ spawn: h.spawn, platform: "darwin", soundPath: "/tmp/score.wav" });
  player.play();
  player.play();
  h.children[0].emit("close", 0);
  player.dispose();
  player.dispose();
  assert.equal(h.children[0].kills, 0, "completed playback is no longer active");
  assert.equal(h.children[1].kills, 1);
  assert.equal(player.play(), false);
  assert.equal(h.calls.length, 2);
});

test("the committed WAV is deterministic PCM RIFF/WAVE with a reasonable size", async () => {
  const { createScoreSoundWav } = await import("../scripts/generate-score-sound.mjs");
  const generated = createScoreSoundWav();
  const committed = nodeFs.readFileSync(nodePath.join(__dirname, "..", "com.ulanzi.sportboard.ulanziPlugin", "assets", "sounds", "score-change.wav"));
  assert.ok(committed.equals(generated));
  assert.equal(committed.toString("ascii", 0, 4), "RIFF");
  assert.equal(committed.toString("ascii", 8, 12), "WAVE");
  assert.equal(committed.readUInt16LE(20), 1, "PCM");
  assert.equal(committed.readUInt16LE(22), 1, "mono");
  assert.equal(committed.readUInt16LE(34), 16);
  assert.ok(committed.length > 10000 && committed.length < 100000);
});
