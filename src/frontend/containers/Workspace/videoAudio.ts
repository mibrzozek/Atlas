import fse from 'fs-extra';
import path from 'path';

import { findBeats, findSwells } from 'common/beats';
import {
  MUSIC_VOLUME,
  MusicTrack,
  SOUND_VOLUME,
  SoundEffect,
  soundPlayback,
  soundsByTime,
  videoLength,
  VideoProject,
} from 'common/video';
import { generateId } from '../../../api/id';

/** The rate songs and sound effects are mixed at for a saved video */
export const MUSIC_SAMPLE_RATE = 48000;

/**
 * The song decoded last: the waveform, the preview and saving all use it. One only, as a decoded song is
 * large (about 115 MB for five minutes of stereo): another one lets go of it
 */
const decoded = new Map<string, Promise<AudioBuffer>>();
/**
 * The sound effects decoded, by file: they are short, so they are kept. A file that fails is tried again
 */
const effects = new Map<string, Promise<AudioBuffer>>();

/** A file of sound decoded into samples. The file is only read */
function decodeFile(file: string): Promise<AudioBuffer> {
  return (async () => {
    const bytes = await fse.readFile(file);
    const context = new OfflineAudioContext(1, 1, MUSIC_SAMPLE_RATE);
    return context.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  })();
}

/** `file` decoded, or being decoded: kept in `cache` until decoding fails */
function decodedIn(cache: Map<string, Promise<AudioBuffer>>, file: string): Promise<AudioBuffer> {
  let buffer = cache.get(file);
  if (buffer === undefined) {
    buffer = decodeFile(file);
    cache.set(file, buffer);
    buffer.catch(() => cache.delete(file));
  }
  return buffer;
}

/** A song decoded into samples: sound effects are kept apart, so decoding one leaves the song in place */
export function decodeMusic(file: string): Promise<AudioBuffer> {
  if (!decoded.has(file)) {
    decoded.clear();
  }
  return decodedIn(decoded, file);
}

function decodeEffect(file: string): Promise<AudioBuffer> {
  return decodedIn(effects, file);
}

/** The song and the sound effects of a video decoded ahead, so that they start at once */
export function decodeAudio(video: VideoProject): void {
  if (video.music !== undefined) {
    decodeMusic(video.music.path).catch(() => undefined);
  }
  for (const sound of soundsByTime(video)) {
    decodeEffect(sound.path).catch(() => undefined);
  }
}

/**
 * The video with the sound effects that can be read: one whose file was moved or deleted since it was added is
 * left out, and its name returned, so that a save is not failed at its end by it
 */
export async function withReadableSounds(
  video: VideoProject,
): Promise<{ video: VideoProject; leftOut: string[] }> {
  const sounds = soundsByTime(video);
  const readable = await Promise.all(
    sounds.map((sound) =>
      decodeEffect(sound.path).then(
        () => true,
        () => false,
      ),
    ),
  );
  const leftOut = sounds.filter((_, i) => !readable[i]);
  if (leftOut.length === 0) {
    return { video, leftOut: [] };
  }
  return {
    video: { ...video, sounds: sounds.filter((_, i) => readable[i]) },
    leftOut: leftOut.map((sound) => sound.name),
  };
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

/** A sound effect made ready to go under a video at `at` seconds: its length found by decoding it */
export async function soundFrom(
  file: string,
  at: number,
  volume = SOUND_VOLUME,
): Promise<SoundEffect> {
  const buffer = await decodeEffect(file);
  return {
    id: generateId(),
    path: file,
    name: path.basename(file, path.extname(file)),
    at,
    volume,
    duration: buffer.duration,
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

/** A source playing `buffer` at `volume` into `output`: not started yet */
function sourceOf(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  volume: number,
  output: AudioNode,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(output);
  return source;
}

/**
 * The audio of a video as it is heard under it, `length` seconds long: the song from where it begins, with
 * its beginning trimmed, at its volume; each sound effect from where it starts, at its volume, cut where the
 * video ends. All of it fades out over the last second. Stereo, at 48 kHz.
 */
export async function mixAudio(video: VideoProject, length: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(length * MUSIC_SAMPLE_RATE)),
    MUSIC_SAMPLE_RATE,
  );
  const master = context.createGain();
  const fade = Math.min(1, length / 4);
  master.gain.setValueAtTime(1, Math.max(0, length - fade));
  master.gain.linearRampToValueAtTime(0, length);
  master.connect(context.destination);
  const { music } = video;
  if (music !== undefined) {
    sourceOf(context, await decodeMusic(music.path), music.volume, master).start(
      music.start,
      music.trim,
    );
  }
  for (const sound of soundsByTime(video)) {
    const playback = soundPlayback(sound, 0, length);
    if (playback !== undefined) {
      sourceOf(context, await decodeEffect(sound.path), sound.volume, master).start(
        playback.wait,
        playback.offset,
        playback.span,
      );
    }
  }
  return context.startRendering();
}

/**
 * The audio played along with the preview, from `time` seconds of the video, as `mixAudio` mixes it. Returns
 * what stops it. Each starts as soon as it is decoded (at once, the second time), from where the video is
 * then: decoding took a moment, and the video went on meanwhile
 */
export function playAudio(video: VideoProject, time: number): () => void {
  const context = new AudioContext();
  const startedAt = performance.now();
  const length = videoLength(video);
  const now = () => time + (performance.now() - startedAt) / 1000;
  const { music } = video;
  if (music !== undefined) {
    decodeMusic(music.path)
      .then((buffer) => {
        if (context.state === 'closed') {
          return;
        }
        const at = now();
        const wait = Math.max(0, music.start - at);
        const from = music.trim + Math.max(0, at - music.start);
        if (from < buffer.duration) {
          sourceOf(context, buffer, music.volume, context.destination).start(
            context.currentTime + wait,
            from,
          );
        }
      })
      .catch((e) => console.error('Could not play the music', music.path, e));
  }
  for (const sound of soundsByTime(video)) {
    decodeEffect(sound.path)
      .then((buffer) => {
        if (context.state === 'closed') {
          return;
        }
        const playback = soundPlayback(sound, now(), length);
        if (playback !== undefined) {
          sourceOf(context, buffer, sound.volume, context.destination).start(
            context.currentTime + playback.wait,
            playback.offset,
            playback.span,
          );
        }
      })
      .catch((e) => console.error('Could not play a sound effect', sound.path, e));
  }
  return () => {
    context.close().catch(() => undefined);
  };
}
