import { shell } from 'electron';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import path from 'path';

import { fileNameOf, writeNewFile } from 'common/export';
import { SHARP_DECODABLE, thumbnailWidthOf } from 'common/sharp-size';
import { borderInsets, cropOf } from 'common/crop';
import {
  closestFrameWidth,
  frameCount,
  hasAudio,
  MUSIC_BITRATE,
  outputSize,
  Pose,
  stateAt,
  videoBeats,
  videoBitrate,
  VideoProject,
  VideoSize,
} from 'common/video';
import { Size, textInk, WorkspaceItem } from 'common/workspace';
import { AppToaster } from '../../components/Toaster';
import { sharpImages } from '../../image/SharpImages';
import type { VideoSaveResult, WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { WorkspacePainter } from './paintWorkspace';
import { mixAudio, MUSIC_SAMPLE_RATE, withReadableSounds } from './videoAudio';

/**
 * The images of a video, each file decoded once, at the size the video shows its largest copy (never larger
 * than its file): drawing a frame then never waits for a decode. For the preview from what the page shows (the
 * thumbnail, which is quick); for a saved video from the file itself.
 */
export class VideoImages {
  private constructor(private readonly bitmaps: Map<string, ImageBitmap>) {}

  static async prepare(
    video: VideoProject,
    items: readonly WorkspaceItem[],
    sources: ReadonlyMap<string, WorkspaceImageSource>,
    /** How wide the frames are drawn, in pixels */
    width: number,
    isFull: boolean,
    onProgress?: (done: number, total: number) => void,
    /** No longer wanted: nothing more is decoded, and what was is let go of (it comes back empty) */
    isCancelled?: () => boolean,
  ): Promise<VideoImages> {
    const needed = neededWidths(video, items, width);
    // A file is decoded once, as wide as its widest item needs it (copies of a photo share its decoding)
    const widest = new Map<string, number>();
    for (const item of items) {
      if (item.kind === 'image' && needed.has(item.id) && sources.has(item.fileId)) {
        widest.set(item.fileId, Math.max(widest.get(item.fileId) ?? 0, needed.get(item.id)!));
      }
    }
    const bitmaps = new Map<string, ImageBitmap>();
    let done = 0;
    // A few at a time: decoding is done off the main thread, but each holds a whole photo meanwhile
    const queue = [...widest];
    const work = async () => {
      for (
        let next = queue.shift();
        next !== undefined && isCancelled?.() !== true;
        next = queue.shift()
      ) {
        const [fileId, across] = next;
        const source = sources.get(fileId)!;
        try {
          bitmaps.set(fileId, await decodeAt(source, across, isFull));
        } catch (e) {
          console.error('Could not decode an image for the video', source.file.absolutePath, e);
        }
        onProgress?.(++done, widest.size);
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    const prepared = new VideoImages(bitmaps);
    if (isCancelled?.() === true) {
      prepared.close();
    }
    return prepared;
  }

  /** The decoded photo of a file: every copy of it is drawn from this one */
  get(fileId: string): ImageBitmap | undefined {
    return this.bitmaps.get(fileId);
  }

  /**
   * Each drawn once into `context`, a pixel large: the first time an image is drawn it is handed to the
   * graphics card, which in the first frames of playing made them late (choppy the first time only)
   */
  warmUpIn(context: CanvasRenderingContext2D): void {
    this.bitmaps.forEach((bitmap) => context.drawImage(bitmap, 0, 0, 1, 1));
  }

  /** Lets go of the decoded pixels at once */
  close(): void {
    this.bitmaps.forEach((bitmap) => bitmap.close());
    this.bitmaps.clear();
  }
}

/**
 * How many pixels across each whole photo of a video needs, by object id, when its frames are drawn
 * `width` pixels wide: as large as it is in any layout (or on the workspace), seen through the closest the
 * camera comes, grown a little by its motions
 */
export function neededWidths(
  video: VideoProject,
  items: readonly WorkspaceItem[],
  width: number,
): Map<string, number> {
  const scale = (width / closestFrameWidth(video)) * MOTION_GROWTH;
  const needed = new Map<string, number>();
  const need = (id: string, pose: Pose) => {
    const across = (pose.width * scale) / (pose.crop?.width ?? 1);
    needed.set(id, Math.max(needed.get(id) ?? 0, across));
  };
  for (const item of items) {
    if (item.kind === 'image') {
      need(item.id, { ...item, crop: cropOf(item) });
    }
  }
  for (const layout of video.layouts) {
    Object.entries(layout.poses).forEach(([id, pose]) => need(id, pose));
  }
  return needed;
}

/**
 * A photo decoded as it is shown (turned by its Exif orientation, as an <img> is), `across` pixels wide.
 * From the file itself when saving, and for the preview whenever its thumbnail has too few pixels for
 * that (a photo filling the frame, a push in): only then, as the thumbnail is much quicker. A file is
 * decoded and scaled in the image workers (`sharpImages`): done here, in the window, a 20 MP photo held
 * it up for a moment each, which made playing choppy while the preview prepared
 */
export async function decodeAt(
  source: WorkspaceImageSource,
  across: number,
  isFull: boolean,
): Promise<ImageBitmap> {
  const { file } = source;
  // A small image is its own thumbnail: the file has nothing more to give
  const thumbnailWidth = thumbnailWidthOf(file);
  const isThumbnailTooSmall = thumbnailWidth < file.width && across > thumbnailWidth * 1.04;
  if ((isFull || isThumbnailTooSmall) && SHARP_DECODABLE.has(file.extension)) {
    const width = Math.max(1, Math.min(file.width, Math.ceil(across)));
    const height = Math.max(1, Math.round((width * file.height) / file.width));
    try {
      return await sharpImages.drawBitmap(file, { width, height });
    } catch (e) {
      console.warn(
        'Could not draw the file for the video, its thumbnail instead',
        file.absolutePath,
        e,
      );
    }
  }
  const image = new Image();
  image.src = source.src;
  await image.decode();
  const width = Math.max(1, Math.min(image.naturalWidth, Math.ceil(across)));
  const bitmap = await createImageBitmap(image, {
    resizeWidth: width,
    resizeHeight: Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth)),
    resizeQuality: 'high',
  });
  image.src = ''; // let go of the full decoded photo
  return bitmap;
}

/** How much larger motions make things at most */
const MOTION_GROWTH = 1.1;

/**
 * One frame of the video as it is at `time`, drawn into the whole of `size`: the background, then the
 * sheets, then everything else from back to front, each where `stateAt` has it: moved, grown and turned
 * around its middle by its motions, as see-through as they make it. `beats` are the music's, in seconds
 * of the video.
 */
export function drawFrame(
  paint: WorkspacePainter,
  size: Size,
  video: VideoProject,
  items: readonly WorkspaceItem[],
  images: VideoImages,
  time: number,
  beats: readonly number[] = videoBeats(video),
): void {
  const { context } = paint;
  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  paint.fill(video.background, { x: 0, y: 0, width: size.width, height: size.height });
  const { frame, objects } = stateAt(video, items, time, beats);
  const scale = size.width / frame.width;
  for (const item of items) {
    const object = objects.get(item.id);
    if (object === undefined || object.opacity <= 0.001) {
      continue;
    }
    const width = object.width * scale;
    const height = object.height * scale;
    const middleX = (object.x - frame.x) * scale + width / 2 + object.dx * width;
    const middleY = (object.y - frame.y) * scale + height / 2 + object.dy * height;
    // Drawn around its middle, so that growing and turning keep it in place
    context.setTransform(1, 0, 0, 1, middleX, middleY);
    if (object.rotation !== 0) {
      context.rotate((object.rotation * Math.PI) / 180);
    }
    if (object.scale !== 1) {
      context.scale(object.scale, object.scale);
    }
    const at = { x: -width / 2, y: -height / 2, width, height };
    context.globalAlpha = Math.min(1, object.opacity);
    if (item.kind === 'background') {
      paint.background(item, at);
    } else if (item.kind === 'text') {
      paint.text(
        item,
        at,
        textInk(item, items, (color) => paint.colorOf(color, '')),
      );
    } else {
      const bitmap = images.get(item.fileId);
      if (bitmap !== undefined && object.crop !== undefined) {
        if (item.border !== undefined) {
          paint.fill(item.border.color, at);
          const { topBottom, sides } = borderInsets(item);
          const sx = width / item.width;
          const sy = height / item.height;
          paint.image(bitmap, object.crop, {
            x: at.x + sides * sx,
            y: at.y + topBottom * sy,
            width: Math.max(1, at.width - 2 * sides * sx),
            height: Math.max(1, at.height - 2 * topBottom * sy),
          });
        } else {
          paint.image(bitmap, object.crop, at);
        }
      }
    }
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
}

/** The objects of a workspace in the order they are drawn: sheets first, then from back to front */
export function drawingOrder(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort(
    (a, b) => (a.kind === 'background' ? -1 : 0) - (b.kind === 'background' ? -1 : 0) || a.z - b.z,
  );
}

/** A whole second between key frames: places a player can start from */
const keyFrameEvery = (video: VideoProject) => video.fps;

/** How far a saving got, and whether it is to be given up */
export interface VideoSaving {
  onProgress: (part: number, what: string) => void;
  isCancelled: () => boolean;
}

/**
 * Saves the video as an MP4 (H.264, and its music as AAC) named `name` in `folder`, never over another
 * file: at its own size, or at phone size (`outputSize`, `videoBitrate`). Every frame is drawn on its own
 * at its exact time, however long that takes: nothing is recorded off the screen, so a frame is never
 * dropped or repeated. Returns where it was saved, or undefined when it was given up.
 */
export async function saveVideo(
  video: VideoProject,
  workspaceItems: readonly WorkspaceItem[],
  sources: ReadonlyMap<string, WorkspaceImageSource>,
  themeOf: HTMLElement,
  options: { name: string; folder: string; size?: VideoSize },
  saving: VideoSaving,
): Promise<string | undefined> {
  const size = options.size ?? 'full';
  const output = outputSize(video, size);
  const items = drawingOrder(workspaceItems);
  const images = await VideoImages.prepare(
    video,
    items,
    sources,
    output.width,
    true,
    (done, total) => saving.onProgress((0.25 * done) / total, 'Preparing the images'),
    saving.isCancelled,
  );
  try {
    const canvas = new OffscreenCanvas(output.width, output.height);
    const paint = new WorkspacePainter(canvas.getContext('2d')!, themeOf);
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: output.width, height: output.height, frameRate: video.fps },
      audio: hasAudio(video)
        ? { codec: 'aac', numberOfChannels: 2, sampleRate: MUSIC_SAMPLE_RATE }
        : undefined,
      fastStart: 'in-memory',
    });
    // The encoder's own error: once it has one it is closed, and every call after throws another that
    // would hide it
    let failure: Error | undefined;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => (failure ??= e),
    });
    const count = frameCount(video);
    try {
      encoder.configure({
        // H.264 Baseline at level 4.2: what this Electron encodes, and what plays everywhere
        codec: 'avc1.42002a',
        width: output.width,
        height: output.height,
        bitrate: videoBitrate(output, video.fps, count / video.fps, size),
        framerate: video.fps,
        avc: { format: 'avc' },
      });
      const microseconds = 1_000_000 / video.fps;
      const beats = videoBeats(video);
      for (let i = 0; i < count && !saving.isCancelled() && failure === undefined; i++) {
        drawFrame(paint, output, video, items, images, i / video.fps, beats);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round(i * microseconds),
          duration: Math.round(microseconds),
        });
        encoder.encode(frame, { keyFrame: i % keyFrameEvery(video) === 0 });
        frame.close();
        // Not too far ahead of the encoder, and the window stays usable meanwhile
        while (encoder.encodeQueueSize > 4 && failure === undefined) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        if (i % 10 === 0) {
          saving.onProgress(0.25 + (0.65 * i) / count, 'Drawing and encoding the frames');
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      if (failure === undefined && !saving.isCancelled()) {
        await encoder.flush().catch((e) => (failure ??= e));
      }
    } finally {
      if (encoder.state !== 'closed') {
        encoder.close();
      }
    }
    if (failure !== undefined) {
      throw failure;
    }
    if (saving.isCancelled()) {
      return undefined;
    }
    if (hasAudio(video)) {
      saving.onProgress(0.92, 'Mixing the audio');
      await encodeAudio(video, count / video.fps, (chunk, meta) =>
        muxer.addAudioChunk(chunk, meta),
      );
    }
    muxer.finalize();
    saving.onProgress(0.97, 'Saving');
    const fileName = `${fileNameOf(options.name) || 'Workspace'}.mp4`;
    return await writeNewFile(options.folder, fileName, new Uint8Array(target.buffer));
  } finally {
    images.close();
  }
}

/** The audio mixed to the video's length and encoded as AAC, its pieces handed to `output` */
async function encodeAudio(
  video: VideoProject,
  length: number,
  output: EncodedAudioChunkOutputCallback,
): Promise<void> {
  const mixed = await mixAudio(video, length);
  // As for the picture: the encoder's own error, not the ones of the calls after it
  let failure: Error | undefined;
  const encoder = new AudioEncoder({ output, error: (e) => (failure ??= e) });
  try {
    encoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: MUSIC_SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: MUSIC_BITRATE,
    });
    const left = mixed.getChannelData(0);
    const right = mixed.getChannelData(1);
    // In pieces of 1024 samples, each channel after the other ('planar')
    const piece = 1024;
    for (let from = 0; from < mixed.length && failure === undefined; from += piece) {
      const frames = Math.min(piece, mixed.length - from);
      const data = new Float32Array(frames * 2);
      data.set(left.subarray(from, from + frames), 0);
      data.set(right.subarray(from, from + frames), frames);
      const audio = new AudioData({
        format: 'f32-planar',
        sampleRate: MUSIC_SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((from / MUSIC_SAMPLE_RATE) * 1_000_000),
        data,
      });
      encoder.encode(audio);
      audio.close();
    }
    if (failure === undefined) {
      await encoder.flush().catch((e) => (failure ??= e));
    }
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
}

/**
 * Saves the video, telling how far it got at the bottom left, and where it went when it is done; and
 * whoever asked, how it went
 */
export async function saveVideoWithProgress(
  video: VideoProject,
  items: readonly WorkspaceItem[],
  sources: ReadonlyMap<string, WorkspaceImageSource>,
  themeOf: HTMLElement,
  options: { name: string; folder: string; size?: VideoSize },
): Promise<VideoSaveResult> {
  let isCancelled = false;
  const key = 'workspace-video';
  const show = (part: number, what: string) =>
    AppToaster.show(
      {
        message: `${what}… ${Math.round(part * 100)}%`,
        timeout: 0,
        clickAction: { label: 'Stop', onClick: () => (isCancelled = true) },
      },
      key,
    );
  show(0, 'Preparing the images');
  try {
    // Before any frame is drawn: a sound effect that cannot be read is left out, not found at the end
    const { video: playable, leftOut } = await withReadableSounds(video);
    const saved = await saveVideo(playable, items, sources, themeOf, options, {
      onProgress: show,
      isCancelled: () => isCancelled,
    });
    const skipped = leftOut.map((name) => `"${name}"`).join(', ');
    const notice = leftOut.length > 1 ? 'sound effects' : 'sound effect';
    const leftOutNote =
      leftOut.length === 0 ? '' : `. Left out ${notice} ${skipped}: the file could not be read`;
    AppToaster.show(
      saved === undefined
        ? { message: 'The video was not saved.', timeout: 5000 }
        : {
            message: `Saved as ${path.basename(saved)}${leftOutNote}`,
            timeout: 10000,
            clickAction: { label: 'Show', onClick: () => shell.showItemInFolder(saved) },
          },
      key,
    );
    return saved === undefined ? { stopped: true } : { saved };
  } catch (e) {
    console.error('Could not save the video', e);
    AppToaster.show({ message: 'The video could not be saved.', timeout: 8000 }, key);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
