import fse from 'fs-extra';
import path from 'path';

import { findBeats, findSwells } from 'common/beats';
import { MUSIC_VOLUME, MusicTrack } from 'common/video';

/** The rate songs are mixed at for a saved video */
export const MUSIC_SAMPLE_RATE = 48000;

/**
 * The song decoded last: the waveform, the preview and saving all use it. One only, as a decoded song is
 * large (about 115 MB for five minutes of stereo): another one lets go of it
 */
const decoded = new Map<string, Promise<AudioBuffer>>();

/** A song decoded into samples. The file is only read */
export function decodeMusic(file: string): Promise<AudioBuffer> {
  let buffer = decoded.get(file);
  if (buffer === undefined) {
    decoded.clear();
    buffer = (async () => {
      const bytes = await fse.readFile(file);
      const context = new OfflineAudioContext(1, 1, MUSIC_SAMPLE_RATE);
      return context.decodeAudioData(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
    })();
    decoded.set(file, buffer);
    buffer.catch(() => decoded.delete(file));
  }
  return buffer;
}

/** A song made ready to go under a video: decoded, and its beats and swells found */
export async function musicFrom(file: string): Promise<MusicTrack> {
  const buffer = await decodeMusic(file);
  const samples = mono(buffer);
  const { bpm, beats } = findBeats(samples, buffer.sampleRate);
  return {
    path: file,
    name: path.basename(file, path.extname(file)),
    start: 0,
    trim: 0,
    duration: buffer.duration,
    volume: MUSIC_VOLUME,
    bpm,
    beats,
    swells: findSwells(samples, buffer.sampleRate),
  };
}

/** The channels of a song as one */
function mono(buffer: AudioBuffer): Float32Array {
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      samples[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return samples;
}

/** How loud a song is in `count` stretches of it, 0 to 1: its waveform */
export function peaksOf(buffer: AudioBuffer, count: number): Float32Array {
  const peaks = new Float32Array(count);
  const data = buffer.getChannelData(0);
  const step = data.length / count;
  let loudest = 1e-6;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const end = Math.min(data.length, Math.floor((i + 1) * step));
    // Every few samples is enough to see the shape
    for (let j = Math.floor(i * step); j < end; j += 8) {
      peak = Math.max(peak, Math.abs(data[j]));
    }
    peaks[i] = peak;
    loudest = Math.max(loudest, peak);
  }
  return peaks.map((peak) => peak / loudest);
}

/**
 * The song as it is heard under a video `length` seconds long: from where it begins in the video, with
 * its beginning trimmed, at its volume, fading out over the last second. Stereo, at 48 kHz.
 */
export async function mixMusic(music: MusicTrack, length: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(length * MUSIC_SAMPLE_RATE)),
    MUSIC_SAMPLE_RATE,
  );
  const source = context.createBufferSource();
  source.buffer = await decodeMusic(music.path);
  const gain = context.createGain();
  const fade = Math.min(1, length / 4);
  gain.gain.setValueAtTime(music.volume, 0);
  gain.gain.setValueAtTime(music.volume, Math.max(0, length - fade));
  gain.gain.linearRampToValueAtTime(0, length);
  source.connect(gain).connect(context.destination);
  source.start(music.start, music.trim);
  return context.startRendering();
}

/**
 * The song played along with the preview, from `time` seconds of the video. Returns what stops it. Starts
 * as soon as the song is decoded (at once, the second time).
 */
export function playMusic(music: MusicTrack, time: number): () => void {
  const context = new AudioContext();
  const startedAt = performance.now();
  decodeMusic(music.path)
    .then((buffer) => {
      if (context.state === 'closed') {
        return;
      }
      // Decoding took a moment: the video went on meanwhile
      const now = time + (performance.now() - startedAt) / 1000;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = music.volume;
      source.connect(gain).connect(context.destination);
      const wait = Math.max(0, music.start - now);
      const from = music.trim + Math.max(0, now - music.start);
      if (from < buffer.duration) {
        source.start(context.currentTime + wait, from);
      }
    })
    .catch((e) => console.error('Could not play the music', music.path, e));
  return () => {
    context.close().catch(() => undefined);
  };
}
