/**
 * A picture of a video's music and what is timed to it, for the Director (development only): Claude cannot
 * hear the result, so the timing is made something to look at. From the top: the song's loudness, its
 * beats (grey ticks), its swells (blue lines, with their time), and every motion as a bar (a wave's crest
 * marked where it crosses the middle), the seconds, and the end of the video (red).
 */
import { crestOf } from 'common/video-motion';
import { videoBeats, videoLength, videoSwells, VideoProject } from 'common/video';
import { decodeMusic, peaksOf } from '../containers/Workspace/videoMusic';

const WIDTH = 1600;
const LOUDNESS_HEIGHT = 140;
const MOTION_HEIGHT = 16;
const RULER_HEIGHT = 22;
/** Loudness measured this many times a second of the song */
const PEAKS_A_SECOND = 50;

export async function soundPicture(video: VideoProject, from = 0, to?: number): Promise<string> {
  const { music } = video;
  if (music === undefined) {
    throw new Error('Its video has no song');
  }
  const until = to ?? Math.max(videoLength(video), 1);
  if (!(until > from)) {
    throw new Error('The end comes before the start');
  }
  const x = (time: number) => ((time - from) / (until - from)) * WIDTH;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = LOUDNESS_HEIGHT + video.motions.length * MOTION_HEIGHT + RULER_HEIGHT + 8;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#16161a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '12px sans-serif';

  // The loudness, at the place in the song each moment of the video plays
  const buffer = await decodeMusic(music.path);
  const peaks = peaksOf(buffer, Math.ceil(buffer.duration * PEAKS_A_SECOND));
  context.fillStyle = '#4f9d69';
  for (let px = 0; px < WIDTH; px++) {
    const songTime = from + ((until - from) * px) / WIDTH - music.start + music.trim;
    const peak = songTime >= 0 ? peaks[Math.floor(songTime * PEAKS_A_SECOND)] ?? 0 : 0;
    const height = peak * (LOUDNESS_HEIGHT - 20);
    context.fillRect(px, LOUDNESS_HEIGHT / 2 - height / 2 + 6, 1, Math.max(1, height));
  }

  const line = (time: number, color: string, top: number, bottom: number, width = 1) => {
    context.fillStyle = color;
    context.fillRect(Math.round(x(time)), top, width, bottom - top);
  };
  videoBeats(video).forEach((beat) => line(beat, '#ffffff40', 0, 8));
  for (const swell of videoSwells(video)) {
    line(swell, '#5aa9ff', 0, LOUDNESS_HEIGHT, 2);
    context.fillStyle = '#5aa9ff';
    context.fillText(`${swell.toFixed(1)}`, x(swell) + 4, 20);
  }

  video.motions.forEach((motion, i) => {
    const top = LOUDNESS_HEIGHT + i * MOTION_HEIGHT + 2;
    context.fillStyle = '#c08a3e';
    context.fillRect(x(motion.start), top, x(motion.start + motion.length) - x(motion.start), 12);
    context.fillStyle = '#16161a';
    context.fillText(motion.kind, x(motion.start) + 3, top + 10);
    if (motion.kind === 'wave') {
      line(crestOf(motion), '#ffffff', top - 2, top + 14, 2);
    }
  });

  // Seconds, and the end
  const ruler = canvas.height - RULER_HEIGHT;
  context.fillStyle = '#ffffffa0';
  for (let second = Math.ceil(from); second <= until; second++) {
    const long = second % 5 === 0;
    line(second, '#ffffff60', ruler, ruler + (long ? 10 : 5));
    if (long) {
      context.fillStyle = '#ffffffa0';
      context.fillText(`${second}s`, x(second) + 3, ruler + 18);
    }
  }
  line(videoLength(video), '#e5484d', 0, canvas.height, 2);
  return canvas.toDataURL('image/png');
}
