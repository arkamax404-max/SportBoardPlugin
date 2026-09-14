// Generates the original score-change sound deterministically: three short
// sine tones with a linear attack/release envelope, encoded as mono PCM WAV.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;
const TONES = [659.25, 783.99, 987.77];
const TONE_SECONDS = 0.09;
const GAP_SECONDS = 0.035;
const AMPLITUDE = 0.32;

export function createScoreSoundWav() {
  const toneSamples = Math.round(SAMPLE_RATE * TONE_SECONDS);
  const gapSamples = Math.round(SAMPLE_RATE * GAP_SECONDS);
  const samples = TONES.length * toneSamples + (TONES.length - 1) * gapSamples;
  const data = Buffer.alloc(samples * 2);
  let output = 0;
  for (let toneIndex = 0; toneIndex < TONES.length; toneIndex += 1) {
    const frequency = TONES[toneIndex];
    for (let index = 0; index < toneSamples; index += 1) {
      const edge = Math.min(index / 220, (toneSamples - 1 - index) / 220, 1);
      const value = Math.round(Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * AMPLITUDE * edge * 32767);
      data.writeInt16LE(value, output * 2);
      output += 1;
    }
    if (toneIndex < TONES.length - 1) output += gapSamples;
  }

  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

export function main() {
  const target = fileURLToPath(new URL("../com.ulanzi.sportboard.ulanziPlugin/assets/sounds/score-change.wav", import.meta.url));
  mkdirSync(dirname(target), { recursive: true });
  const wav = createScoreSoundWav();
  writeFileSync(target, wav);
  console.log(`sound: wrote ${wav.length} bytes to com.ulanzi.sportboard.ulanziPlugin/assets/sounds/score-change.wav`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
