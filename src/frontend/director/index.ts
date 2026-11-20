/**
 * The Director, in the page: development only (`src/renderer.tsx` installs it behind
 * `process.env.NODE_ENV === 'development'`; the production build leaves it out). The main process
 * (`src/director/main.ts`) hands it any plain name: the commands below are the only ones there are
 * (adding one needs a reload of the window, the `reload` command), each done with the stores and
 * entities, as the buttons do. Nothing here reads or writes a folder: a song's or a sound effect's place in
 * `audio/` and the `demo/` folder come from the main process, and the photos are only read.
 */
import { ipcRenderer } from 'electron';
import { runInAction } from 'mobx';

import { EditStyle } from 'common/auto-edit';
import { subjectOnFrame } from 'common/crop';
import {
  arrivalTimeOf,
  EASINGS,
  FRAME_RATES,
  frameAround,
  InRow,
  MAX_SOUND_VOLUME,
  SOUND_VOLUME,
  soundsByTime,
  startsOf,
  stateAt,
  VIDEO_FORMATS,
  videoLength,
  VideoProject,
  VideoSize,
  videoSwells,
} from 'common/video';
import { photoPath } from 'common/photo-path';
import { crestOf } from 'common/video-motion';
import {
  boundsOf,
  LayoutKind,
  Point,
  Rect,
  rowsAndColumnsOf,
  Size,
  WorkspaceImageItem,
  suggestedCount,
} from 'common/workspace';
import {
  ANSWER_CHANNEL,
  CALL_CHANNEL,
  DIRECTOR_HOLD,
  DirectorAnswer,
  READY_CHANNEL,
} from '../../director/channels';
import { WorkspacePainter } from '../containers/Workspace/paintWorkspace';
import {
  decodeAt,
  drawFrame,
  drawingOrder,
  VideoImages,
} from '../containers/Workspace/workspaceVideo';
import { ClientWorkspace } from '../entities/Workspace';
import RootStore from '../stores/RootStore';
import { batchOfCollection, batchOfTag } from '../stores/WorkspaceStore';
import {
  cutMoments,
  isFraming,
  isMiddleIn,
  isPointIn,
  isTextCutOff,
  MotionChanges,
  motionChanges,
  numbered,
  numberOf,
  photoIds,
  photoNumbers,
  Places,
  ShotChanges,
  shotFrame,
  shotSettings,
  timelineWarnings,
} from './edits';
import { soundPicture } from './soundPicture';

/** How long to wait for a workspace to be on screen and its images ready, in ms */
const READY_TIMEOUT = 2 * 60_000;
/** The size of a moment in `picture`, in pixels: small, it is only to look at */
const PICTURE_WIDTH = 180;
/** The most moments in one `picture`: four rows of eight */
const MAX_PICTURE_TIMES = 32;
/** The default width of a moment of `cuts` or a photo of `contact`, in pixels */
const SHEET_WIDTH = 360;
/** The most photos on one `contact` sheet: four rows of eight, as `picture` */
const MAX_CONTACT_PHOTOS = 32;
/** The widest spacing `arrange` takes, in pixels of the workspace */
const MAX_GAP = 400;
/** The width of `photos`, the numbered picture of everything, in pixels */
const PHOTOS_WIDTH = 960;
/** Lanes as the edits name them */
const LANES = { shot: 'camera', layout: 'layout', motion: 'motion' } as const;

/** A width of a picture in pixels, 120 to 1080, or the default */
const widthOf = (width: number | undefined, fallback: number) =>
  width === undefined ? fallback : numberOf(width, 'width', 120, 1080);
/** A frame of the video `width` pixels wide, as tall as the video */
const cellOf = (video: VideoProject, width: number): Size => ({
  width,
  height: Math.round((width * video.height) / video.width),
});
/** A label on a sheet: white on a dark tag, its top left corner at (left, top); the caller sets the font */
function tag(context: CanvasRenderingContext2D, text: string, left: number, top: number): void {
  const width = context.measureText(text).width + 10;
  context.fillStyle = 'rgba(0, 0, 0, 0.75)';
  context.fillRect(left, top, width, 24);
  context.fillStyle = '#ffffff';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText(text, left + 5, top + 4);
}

export function installDirector(rootStore: RootStore): void {
  const { uiStore, tagStore, collectionStore, workspaceStore } = rootStore;

  const workspaceOf = (id: unknown): ClientWorkspace => {
    const workspace = workspaceStore.workspaceList.find((w) => w.id === id);
    if (workspace === undefined) {
      throw new Error('No workspace ' + String(id));
    }
    return workspace;
  };
  const imagesOf = (workspace: ClientWorkspace) =>
    workspace.items.slice().filter((item): item is WorkspaceImageItem => item.kind === 'image');
  /** The workspace on screen (saving and pictures need it) and all its images ready */
  const ready = async (workspace: ClientWorkspace) => {
    if (uiStore.activeWorkspace !== workspace) {
      uiStore.openWorkspace(workspace);
    }
    const until = Date.now() + READY_TIMEOUT;
    for (;;) {
      const images = workspaceStore.imagesOf(workspace);
      const isReady =
        workspaceStore.surface !== undefined &&
        images !== undefined &&
        workspace.fileIds.every((id) => images.sources.has(id));
      if (isReady) {
        return { images: images!, surface: workspaceStore.surface! };
      }
      if (Date.now() > until) {
        throw new Error('Its images did not get ready');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  const videoOf = (workspace: ClientWorkspace): VideoProject => {
    if (workspace.video === undefined) {
      throw new Error('Start its video first');
    }
    return workspace.video;
  };
  /** Where its photos and texts are at a moment of its video */
  const placesAt = (workspace: ClientWorkspace, time: number): Places => {
    const items = workspace.items.slice();
    const { objects } = stateAt(videoOf(workspace), items, time);
    const subjects = new Map<string, Point>();
    for (const item of items) {
      const object = objects.get(item.id);
      if (item.kind === 'image' && item.subject !== undefined && object?.crop !== undefined) {
        const subject = subjectOnFrame(item.subject, object, object.crop);
        if (subject !== undefined) {
          subjects.set(item.id, subject);
        }
      }
    }
    return {
      photos: items.filter((item) => item.kind === 'image').map((item) => item.id),
      texts: items.filter((item) => item.kind === 'text').map((item) => item.id),
      at: new Map(
        [...objects].map(([id, o]) => [id, { x: o.x, y: o.y, width: o.width, height: o.height }]),
      ),
      subjects,
    };
  };
  /** The middle of a shot, in seconds of the video: what it shows is looked for then */
  const middleOfShot = (video: VideoProject, n: number) =>
    startsOf(video.camera)[n] + video.camera[n].length / 2;
  /** The number a sound effect has in `timeline`: by when it starts */
  const numberOfSound = (video: VideoProject, id: string) =>
    soundsByTime(video).findIndex((sound) => sound.id === id) + 1;
  /** A shot changed (`ShotChanges`): its length first, as the moment it shows depends on it */
  const changeShot = (workspace: ClientWorkspace, id: string, changes: ShotChanges) => {
    const settings = shotSettings(changes);
    if (changes.length !== undefined) {
      workspace.setBlockLength('camera', id, numberOf(changes.length, 'length', 0.1, 3600));
    }
    workspace.changeCameraStop(id, settings);
    if (isFraming(changes)) {
      const video = videoOf(workspace);
      const n = video.camera.findIndex((stop) => stop.id === id);
      const frame = shotFrame(
        video.camera[n].frame,
        video.width / video.height,
        changes,
        placesAt(workspace, middleOfShot(video, n)),
      );
      workspace.changeCameraStop(id, { frame });
    }
  };
  /**
   * Moments of a video drawn side by side as a JPEG (as data), then `over` drawn on it. The surface is
   * looked up only after the images are decoded: it can change while they are
   */
  const paintFrames = async (
    workspace: ClientWorkspace,
    video: VideoProject,
    cell: Size,
    times: readonly number[],
    over?: (context: CanvasRenderingContext2D) => void,
  ) => {
    const { images } = await ready(workspace);
    const items = drawingOrder(workspace.items.slice());
    const decoded = await VideoImages.prepare(video, items, images.sources, cell.width, false);
    try {
      const { surface } = await ready(workspace);
      const sheet = document.createElement('canvas');
      sheet.width = cell.width * Math.min(8, times.length);
      sheet.height = cell.height * Math.ceil(times.length / 8);
      const frame = document.createElement('canvas');
      frame.width = cell.width;
      frame.height = cell.height;
      const paint = new WorkspacePainter(frame.getContext('2d')!, surface.viewport);
      const context = sheet.getContext('2d')!;
      times.forEach((time, i) => {
        drawFrame(paint, cell, video, items, decoded, Number(time));
        context.drawImage(frame, (i % 8) * cell.width, Math.floor(i / 8) * cell.height);
      });
      over?.(context);
      return sheet.toDataURL('image/jpeg', 0.8);
    } finally {
      decoded.close();
    }
  };
  const tenths = (n: number) => Math.round(n * 10) / 10;

  const commands: Record<string, (...args: any[]) => unknown> = {
    tags: () =>
      runInAction(() =>
        tagStore.tagList.slice().map((tag) => ({ name: tag.name, photos: tag.fileCount })),
      ),

    collections: () =>
      runInAction(() =>
        collectionStore.collectionList.slice().map((c) => ({
          name: c.name,
          tags: c.tags.map((tag) => tag.name),
        })),
      ),

    workspaces: () =>
      workspaceStore.workspaceList.slice().map((w) => ({
        id: w.id,
        name: w.name,
        photos: w.fileIds.length,
        hasVideo: w.video !== undefined,
      })),

    /**
     * A new workspace of the photos of a tag or a collection, by name, opened; with `sample`, that many
     * of them picked at random (`seed`: the same ones again)
     */
    create: async (
      name: string,
      from: { tag?: string; collection?: string; sample?: number; seed?: number },
    ) => {
      const batch = runInAction(() => {
        if (from.tag !== undefined) {
          const tag = tagStore.findByName(from.tag);
          return tag !== undefined ? batchOfTag(tag) : undefined;
        }
        const collection = collectionStore.collectionList.find((c) => c.name === from.collection);
        return collection !== undefined ? batchOfCollection(collection) : undefined;
      });
      if (batch === undefined) {
        throw new Error('No such tag or collection');
      }
      const sample =
        from.sample !== undefined
          ? { count: Math.max(1, Number(from.sample)), seed: Number(from.seed ?? Date.now()) }
          : undefined;
      const workspace = await workspaceStore.createOf(batch, String(name), sample);
      return { id: workspace.id, name: workspace.name, photos: workspace.fileIds.length };
    },

    /**
     * Its photos in columns, rows or a grid, never a row or column of a single photo; or only some of
     * them (`photos`, by number), and those `below` the rest if asked
     */
    arrange: (
      id: string,
      style: LayoutKind,
      count?: number,
      gap = 18,
      only: { photos?: number[]; below?: boolean } = {},
    ) => {
      const workspace = workspaceOf(id);
      if (!['columns', 'rows', 'grid'].includes(style)) {
        throw new Error('The style is columns, rows or grid');
      }
      const all = imagesOf(workspace).map((item) => item.id);
      const ids =
        only.photos !== undefined
          ? photoIds({ photos: all, texts: [], at: new Map() }, only.photos)
          : all;
      if (ids.length < 2) {
        throw new Error('Arranging takes two photos or more');
      }
      const lines = Math.min(
        ids.length,
        Math.max(1, Number(count ?? suggestedCount(style, ids.length))),
      );
      workspace.selectMany(ids, false);
      workspace.arrangeSelection(style, lines, {
        gap: Math.min(MAX_GAP, Math.max(0, Number(gap))),
        fill: style !== 'grid',
        even: true,
        crop: style === 'grid' ? '1:1' : undefined,
        below: only.below === true,
      });
      workspace.clearSelection();
      const arranged = imagesOf(workspace).filter((item) => ids.includes(item.id));
      return [...rowsAndColumnsOf(arranged, style === 'columns' ? 'columns' : 'rows')]
        .sort(([a], [b]) => a - b)
        .map(([, line]) => line.length);
    },

    /**
     * Its photos along a path to pan over (`photoPath`), right of everything else and out of its way, as
     * high as they are now, each leg over the ones after it: one change to undo. Where the camera starts, and each leg with the frame at
     * its end and the photos to hide before it begins, by number
     */
    path: (id: string, seed: number, gap = 18, how: { turns?: 'random' | 'loop' } = {}) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      const items = workspace.items.slice();
      const images = imagesOf(workspace);
      const heights = images.map((item) => item.height).sort((a, b) => a - b);
      const rowHeight = heights[Math.floor(heights.length / 2)];
      const everything = boundsOf(items);
      const rest = boundsOf(items.filter((item) => item.kind !== 'image'));
      if (everything === undefined || images.length < 2 || workspace.isLocked) {
        throw new Error('A path takes two photos or more, on a workspace that is not locked');
      }
      const path = photoPath(
        images.map((item) => ({ id: item.id, aspect: item.width / item.height })),
        {
          origin: { x: everything.x + everything.width + rowHeight * 2, y: everything.y },
          rowHeight,
          aspect: video.width / video.height,
          gap: Math.min(MAX_GAP, Math.max(0, Number(gap))),
          seed: Number(seed),
          avoid: rest !== undefined ? [rest] : [],
          turns: how.turns === 'loop' ? 'loop' : 'random',
        },
      );
      // Each leg over the ones after it: a photo laid where another was before stays under it until the
      // one before is hidden
      workspace.arrange(
        Object.fromEntries(path.places),
        path.legs.flatMap((leg) => leg.photos),
      );
      const photoNumber = (photo: string) => images.findIndex((item) => item.id === photo) + 1;
      const rounded = (rect: Rect) =>
        [rect.x, rect.y, rect.width, rect.height].map((n) => Math.round(n * 10) / 10);
      return {
        start: rounded(path.start),
        legs: path.legs.map((leg) => ({
          direction: leg.direction,
          photos: leg.photos.map(photoNumber),
          hides: leg.hides.map(photoNumber),
          frame: rounded(leg.frame),
        })),
      };
    },

    /** The same arrangement, its photos in another order */
    shuffle: (id: string, seed: number) => {
      const workspace = workspaceOf(id);
      workspace.selectMany(
        imagesOf(workspace).map((item) => item.id),
        false,
      );
      const isShuffled = workspace.shuffleSelection(Number(seed));
      workspace.clearSelection();
      if (!isShuffled) {
        throw new Error('Arrange it first (or it is locked)');
      }
      return 'shuffled';
    },

    /** A title over the photos, a line under it, and a sheet behind everything (`addTitle`) */
    title: (
      id: string,
      text: string,
      line = '',
      colors: { title?: string; sheet?: string } = {},
    ) => {
      if (!workspaceOf(id).addTitle(String(text), String(line), colors)) {
        throw new Error('No photos to put a title over (or it is locked)');
      }
      return 'titled';
    },

    /** The video, started if it has none, in a format (9:16, 4:5, 1:1, 16:9), framing everything */
    video: (id: string, format = '9:16') => {
      const workspace = workspaceOf(id);
      if (workspace.video === undefined) {
        workspace.startVideo(
          boundsOf(workspace.items.slice()) ?? { x: 0, y: 0, width: 1080, height: 1920 },
        );
      }
      const size = VIDEO_FORMATS.find((f) => f.name.includes(`(${format})`));
      if (size === undefined) {
        throw new Error('The format is 9:16, 4:5, 1:1 or 16:9');
      }
      workspace.setVideoSize(size);
      workspace.fitVideoFrame();
      return { width: size.width, height: size.height };
    },

    /** The workspace as it is arranged now, as the next layout of its video */
    layout: (id: string) => {
      const workspace = workspaceOf(id);
      if (workspace.video === undefined) {
        throw new Error('Start its video first');
      }
      workspace.clearBlockSelection();
      workspace.addLayout();
      workspace.clearBlockSelection();
      return workspace.video.layouts.length;
    },

    music: async (id: string, file: string) => {
      const music = await workspaceStore.addMusic(workspaceOf(id), file);
      workspaceOf(id).clearBlockSelection();
      return { song: music.name, bpm: Math.round(music.bpm) };
    },

    /**
     * A sound effect (a name `effects` lists) starting at `at` seconds of the video, at `volume` (0 to 1.5):
     * one change to undo. Its number, as `timeline` gives it
     */
    sound: async (id: string, file: string, at: number, changes: { volume?: number } = {}) => {
      const workspace = workspaceOf(id);
      videoOf(workspace);
      const sound = await workspaceStore.addSound(
        workspace,
        file,
        numberOf(at, 'at', 0, 3600),
        numberOf(changes.volume ?? SOUND_VOLUME, 'volume', 0, MAX_SOUND_VOLUME),
      );
      return numberOfSound(videoOf(workspace), sound.id);
    },

    /** Where the video ends, in seconds; nothing: at the end of its camera again */
    end: (id: string, seconds?: number) => {
      const workspace = workspaceOf(id);
      if (workspace.video === undefined) {
        throw new Error('Start its video first');
      }
      workspace.setVideoEnd(
        seconds === undefined ? undefined : numberOf(seconds, 'The end', 1, 3600),
      );
      return videoLength(workspace.video);
    },

    /** A wave through its photos on every swell of its song (`wavesToTheMusic`); how many */
    waves: (id: string, strength = 1) => {
      const workspace = workspaceOf(id);
      if (workspace.video?.music?.swells === undefined) {
        throw new Error('Give it a song first (songs added before waves existed: add it again)');
      }
      return workspace.wavesToTheMusic(Math.min(3, Math.max(0, Number(strength))));
    },

    edit: (id: string, style: EditStyle, seed: number) => {
      const workspace = workspaceOf(id);
      if (!['cuts', 'flow', 'mixed'].includes(style)) {
        throw new Error('The style is cuts, flow or mixed');
      }
      workspace.cutToTheBeat(style, Number(seed));
      return commands.state(id);
    },

    /** Saved into `folder` (given by the main process: demo/), as a new file; where it went */
    save: async (id: string, size: VideoSize, folder: string) => {
      const workspace = workspaceOf(id);
      await ready(workspace);
      const result = await workspaceStore.saveVideo(workspace, {
        name: workspace.name,
        folder,
        size,
      });
      if ('saved' in result) {
        return result.saved;
      }
      throw new Error('error' in result ? result.error : 'It was stopped');
    },

    /** Moments of its video side by side, small (`width`: 120 to 1080): a JPEG as data, to look at */
    picture: async (id: string, times: number[], options: { width?: number } = {}) => {
      const workspace = workspaceOf(id);
      const { video } = workspace;
      if (video === undefined || !Array.isArray(times) || times.length === 0) {
        throw new Error('It needs a video and the times to show');
      }
      if (times.length > MAX_PICTURE_TIMES) {
        throw new Error(`At most ${MAX_PICTURE_TIMES} times: four rows of eight`);
      }
      return paintFrames(
        workspace,
        video,
        cellOf(video, widthOf(options.width, PICTURE_WIDTH)),
        times.map((time) => numberOf(time, 'A time', 0, 3600)),
      );
    },

    /**
     * The cuts of its video side by side, as a JPEG (as data): the first frame, then for each cut the last
     * moment of the shot before and the arrival of the next, each labelled `n|n+1` with its time, then the
     * last frame. 32 moments at most: `from` (a shot number) starts a page
     */
    cuts: async (id: string, options: { width?: number; from?: number } = {}) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      if (video.camera.length === 0) {
        throw new Error('It has no shots');
      }
      const from = numberOf(options.from ?? 1, 'from', 1, video.camera.length);
      const cell = cellOf(video, widthOf(options.width, SHEET_WIDTH));
      const moments = cutMoments(video.camera, video.fps, videoLength(video), from);
      return paintFrames(
        workspace,
        video,
        cell,
        moments.map((moment) => moment.time),
        (context) => {
          context.font = 'bold 16px sans-serif';
          moments.forEach((moment, i) =>
            tag(
              context,
              `${moment.label}  ${moment.time.toFixed(2)} s`,
              (i % 8) * cell.width + 6,
              Math.floor(i / 8) * cell.height + 6,
            ),
          );
        },
      );
    },

    /**
     * Each photo alone and whole, fitted into a square cell (letterboxed on black), numbered as `timeline`
     * numbers them: to judge focus, subject and light before choosing shots. As a JPEG (as data); 32 to a
     * sheet, `from` a photo number starts a page. The video and the workspace are not changed
     */
    contact: async (id: string, options: { width?: number; from?: number } = {}) => {
      const workspace = workspaceOf(id);
      const photos = imagesOf(workspace);
      if (photos.length === 0) {
        throw new Error('It has no photos');
      }
      const first = numberOf(options.from ?? 1, 'from', 1, photos.length);
      const cell = widthOf(options.width, SHEET_WIDTH);
      const page = photos.slice(first - 1, first - 1 + MAX_CONTACT_PHOTOS);
      const { images } = await ready(workspace);
      const sheet = document.createElement('canvas');
      sheet.width = cell * Math.min(8, page.length);
      sheet.height = cell * Math.ceil(page.length / 8);
      const context = sheet.getContext('2d')!;
      for (const [i, item] of page.entries()) {
        const x = (i % 8) * cell;
        const y = Math.floor(i / 8) * cell;
        context.fillStyle = '#000000';
        context.fillRect(x, y, cell, cell);
        const source = images.sources.get(item.fileId);
        if (source !== undefined) {
          try {
            const bitmap = await decodeAt(source, cell, true);
            try {
              const scale = Math.min(cell / bitmap.width, cell / bitmap.height);
              const width = bitmap.width * scale;
              const height = bitmap.height * scale;
              context.drawImage(
                bitmap,
                x + (cell - width) / 2,
                y + (cell - height) / 2,
                width,
                height,
              );
            } finally {
              bitmap.close();
            }
          } catch (e) {
            console.error(
              'Could not decode a photo for the contact sheet',
              source.file.absolutePath,
              e,
            );
          }
        }
        context.font = 'bold 18px sans-serif';
        tag(context, String(first + i), x + 6, y + 6);
      }
      return sheet.toDataURL('image/jpeg', 0.8);
    },

    /**
     * Everything at a moment of the video (the start: 0), each photo with its number on it and the shot of
     * that moment outlined: a JPEG as data, to choose photos by number
     */
    photos: async (id: string, time = 0) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      const moment = numberOf(time, 'The time', 0, 3600);
      const places = placesAt(workspace, moment);
      const { frame: shot } = stateAt(video, workspace.items.slice(), moment);
      const area = boundsOf([...places.at.values(), shot]);
      if (area === undefined) {
        throw new Error('Nothing in the video at that moment');
      }
      const frame = frameAround(area, area.width / area.height, 0.02);
      const cell = {
        width: PHOTOS_WIDTH,
        height: Math.round((PHOTOS_WIDTH * frame.height) / frame.width),
      };
      const scale = cell.width / frame.width;
      const onSheet = (rect: Rect) => ({
        x: (rect.x - frame.x) * scale,
        y: (rect.y - frame.y) * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      });
      // The whole of it, without the camera, and every photo seen (none still to come in)
      const overview: VideoProject = { ...video, camera: [], motions: [], frame };
      return paintFrames(workspace, overview, cell, [moment], (context) => {
        context.lineWidth = 3;
        context.strokeStyle = '#ffd400';
        const s = onSheet(shot);
        context.strokeRect(s.x, s.y, s.width, s.height);
        context.font = 'bold 18px sans-serif';
        places.photos.forEach((photo, i) => {
          const place = places.at.get(photo);
          if (place !== undefined) {
            const p = onSheet(place);
            const subject = places.subjects?.get(photo);
            if (subject !== undefined) {
              context.beginPath();
              context.arc(
                (subject.x - frame.x) * scale,
                (subject.y - frame.y) * scale,
                12,
                0,
                2 * Math.PI,
              );
              context.strokeStyle = '#00e5ff';
              context.stroke();
            }
            const label = String(i + 1);
            const width = context.measureText(label).width + 10;
            tag(context, label, p.x + p.width / 2 - width / 2, p.y + p.height / 2 - 12);
          }
        });
      });
    },

    /** Every shot, layout and motion of its video, numbered, with what they do: what the edits change */
    timeline: (id: string) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      const allPlaces = placesAt(workspace, 0);
      const shotStarts = startsOf(video.camera);
      const layoutStarts = startsOf(video.layouts);
      const images = imagesOf(workspace);
      const shaped = (isWide: boolean) =>
        images.flatMap((item, i) =>
          item.kind === 'image' && item.imageAspect > 1 === isWide ? [i + 1] : [],
        );
      const beat =
        video.music !== undefined && video.music.bpm > 0 ? 60 / video.music.bpm : undefined;
      const found = video.camera.map((stop, i) => {
        const places = placesAt(workspace, middleOfShot(video, i));
        const arrived = placesAt(workspace, shotStarts[i] + arrivalTimeOf(stop));
        const shown = places.photos.filter((photo) => {
          const place = places.at.get(photo);
          return place !== undefined && isMiddleIn(place, stop.frame);
        });
        const textsOf = (p: Places) => p.texts.flatMap((text) => p.at.get(text) ?? []);
        const subjectOfShown = shown.length === 1 ? places.subjects?.get(shown[0]) : undefined;
        return {
          row: {
            n: i + 1,
            at: tenths(shotStarts[i]),
            length: tenths(stop.length),
            arrival: stop.arrival,
            arrivalTime: tenths(stop.arrivalTime),
            stay: stop.stay,
            easing: stop.easing,
            shows: photoNumbers(places, shown),
            frame: [stop.frame.x, stop.frame.y, stop.frame.width, stop.frame.height].map(
              Math.round,
            ),
          },
          facts: {
            n: i + 1,
            length: stop.length,
            shows: shown.map((photo) => places.photos.indexOf(photo) + 1),
            showsText: textsOf(places).some((text) => isMiddleIn(text, stop.frame)),
            textsCutOff: [...textsOf(places), ...textsOf(arrived)].some((text) =>
              isTextCutOff(text, stop.frame),
            ),
            subjectOutside: subjectOfShown !== undefined && !isPointIn(subjectOfShown, stop.frame),
          },
        };
      });
      return {
        length: tenths(videoLength(video)),
        isEndSet: video.end !== undefined,
        fps: video.fps,
        background: video.background,
        photos: allPlaces.photos.length,
        /** The photos by their shape: wider than high, or not */
        wide: shaped(true),
        tall: shaped(false),
        shots: found.map((shot) => shot.row),
        warnings: timelineWarnings(
          found.map((shot) => shot.facts),
          beat,
        ),
        layouts: video.layouts.map((layout, i) => ({
          n: i + 1,
          at: tenths(layoutStarts[i]),
          length: tenths(layout.length),
          transition: tenths(layout.transition),
          easing: layout.easing,
        })),
        motions: video.motions.map((motion, i) => ({
          n: i + 1,
          kind: motion.kind,
          at: tenths(motion.start),
          length: tenths(motion.length),
          strength: tenths(motion.strength),
          speed: tenths(motion.speed),
          stagger: Math.round(motion.stagger * 100) / 100,
          photos: photoNumbers(allPlaces, motion.targets),
        })),
        music:
          video.music === undefined
            ? undefined
            : {
                song: video.music.name,
                start: tenths(video.music.start),
                trim: tenths(video.music.trim),
                volume: tenths(video.music.volume),
                bpm: Math.round(video.music.bpm),
              },
        sounds: soundsByTime(video).map((sound, i) => ({
          n: i + 1,
          name: sound.name,
          at: tenths(sound.at),
          length: tenths(sound.duration),
          volume: Math.round(sound.volume * 100) / 100,
        })),
      };
    },

    /**
     * The subject of a photo, as fractions of the whole photo (x from the left, y from the top; 0 to 1): what a
     * shot of it frames on. Without x and y, it is taken away. One change to undo
     */
    subject: (id: string, photo: number, x?: number, y?: number) => {
      const workspace = workspaceOf(id);
      if (workspace.isLocked) {
        throw new Error('It is locked');
      }
      const item = numbered(imagesOf(workspace), photo, 'photo');
      const subject =
        x === undefined && y === undefined
          ? undefined
          : { x: numberOf(x, 'x', 0, 1), y: numberOf(y, 'y', 0, 1) };
      workspace.setSubject(item.id, subject);
      return subject ?? 'removed';
    },

    /** A shot changed (`ShotChanges` in `edits.ts`): one change to undo */
    setShot: (id: string, n: number, changes: ShotChanges) => {
      const workspace = workspaceOf(id);
      const stop = numbered(videoOf(workspace).camera, n, 'shot');
      workspace.rememberVideo();
      changeShot(workspace, stop.id, changes ?? {});
      return 'changed';
    },

    /** A new shot after shot `after` (0: the first), of `changes`; the end of the video stays put */
    addShot: (id: string, after: number, changes: ShotChanges = {}) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      const at = numberOf(after, 'after', 0, video.camera.length);
      shotSettings(changes);
      workspace.clearBlockSelection();
      workspace.addCameraStop(undefined, at > 0 ? video.camera[at - 1].id : undefined);
      const added = workspace.selectedBlock!.id;
      workspace.clearBlockSelection();
      if (at === 0) {
        workspace.moveBlock('camera', added, 0, true);
      }
      // Adding a stop puts the end on the end of the camera again: the end set by hand stays
      workspace.setVideoEnd(video.end);
      changeShot(workspace, added, changes);
      return { shot: at + 1, shots: videoOf(workspace).camera.length };
    },

    /** A new motion of photos (numbers, or "all") from `start`; then `changes` */
    addMotion: (
      id: string,
      kind: string,
      photos: number[] | 'all',
      start: number,
      changes: MotionChanges = {},
    ) => {
      const workspace = workspaceOf(id);
      videoOf(workspace);
      const places = placesAt(workspace, 0);
      const checked = motionChanges({ ...changes, kind, photos, start }, places);
      if (
        checked.kind === undefined ||
        checked.targets === undefined ||
        checked.start === undefined
      ) {
        throw new Error('addMotion <id> <kind> <photos> <start> [changes]');
      }
      workspace.addMotion(checked.kind, checked.targets, checked.start);
      const added = workspace.selectedBlock!.id;
      workspace.clearBlockSelection();
      workspace.changeMotion(added, checked);
      return { motion: videoOf(workspace).motions.length };
    },

    /** A motion changed (`MotionChanges` in `edits.ts`): one change to undo */
    setMotion: (id: string, n: number, changes: MotionChanges) => {
      const workspace = workspaceOf(id);
      const motion = numbered(videoOf(workspace).motions, n, 'motion');
      const checked = motionChanges(changes ?? {}, placesAt(workspace, 0));
      workspace.rememberVideo();
      workspace.changeMotion(motion.id, checked);
      return 'changed';
    },

    /** A layout's length, how long its photos take to glide there, and how: one change to undo */
    setLayout: (
      id: string,
      n: number,
      changes: { length?: number; transition?: number; easing?: string },
    ) => {
      const workspace = workspaceOf(id);
      const layout = numbered(videoOf(workspace).layouts, n, 'layout');
      const { length, transition, easing } = changes ?? {};
      if (easing !== undefined && !EASINGS.some((e) => e.easing === easing)) {
        throw new Error(`easing is ${EASINGS.map((e) => e.easing).join(', ')}`);
      }
      workspace.rememberVideo();
      if (length !== undefined) {
        workspace.setBlockLength('layout', layout.id, numberOf(length, 'length', 0.1, 3600));
      }
      workspace.changeLayout(layout.id, {
        ...(transition !== undefined
          ? { transition: numberOf(transition, 'transition', 0, 60) }
          : {}),
        ...(easing !== undefined ? { easing: easing as (typeof EASINGS)[number]['easing'] } : {}),
      });
      return 'changed';
    },

    /**
     * Shots, layouts, motions or sound effects removed: by their numbers, or (motions) every one of a kind,
     * such as "pulse". One change to undo
     */
    remove: (id: string, lane: keyof typeof LANES | 'sound', ...which: (number | string)[]) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      if (lane === 'sound') {
        const sounds = soundsByTime(video);
        const ids = [...new Set(which.map((w) => numbered(sounds, w, 'sound').id))];
        if (ids.length === 0) {
          throw new Error('Nothing to remove');
        }
        ids.forEach((soundId, i) => workspace.removeSound(soundId, i > 0));
        return { removed: ids.length };
      }
      if (!Object.prototype.hasOwnProperty.call(LANES, lane)) {
        throw new Error('Remove a shot, layout, motion or sound');
      }
      const blocks: readonly { id: string; kind?: string }[] =
        lane === 'shot' ? video.camera : lane === 'layout' ? video.layouts : video.motions;
      const ids = new Set(
        which.flatMap((w) =>
          lane === 'motion' && typeof w === 'string' && !/^\d+$/.test(w)
            ? video.motions.filter((m) => m.kind === w).map((m) => m.id)
            : [numbered(blocks, w, lane).id],
        ),
      );
      if (ids.size === 0) {
        throw new Error('Nothing to remove');
      }
      workspace.clearBlockSelection();
      [...ids].forEach((block, i) => workspace.removeBlock(LANES[lane], block, i > 0));
      return { removed: ids.size };
    },

    /** A shot or a layout put at another place in its row: `n` becomes `to` */
    move: (id: string, lane: 'shot' | 'layout', n: number, to: number) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      if (lane !== 'shot' && lane !== 'layout') {
        throw new Error('Move a shot or a layout');
      }
      const blocks: readonly InRow[] = lane === 'shot' ? video.camera : video.layouts;
      const block = numbered(blocks, n, lane);
      workspace.moveBlock(LANES[lane], block.id, numberOf(to, 'to', 1, blocks.length) - 1);
      return 'moved';
    },

    undo: (id: string) => {
      workspaceOf(id).undo();
      return 'undone';
    },

    redo: (id: string) => {
      workspaceOf(id).redo();
      return 'redone';
    },

    /**
     * A sound effect's start (`at`, seconds of the video) and volume (0 to 1.5), by its number as `timeline`
     * gives it: one change to undo. Its number after the change (they are in time order)
     */
    setSound: (id: string, n: number, changes: { at?: number; volume?: number } = {}) => {
      const workspace = workspaceOf(id);
      const video = videoOf(workspace);
      const sound = numbered(soundsByTime(video), n, 'sound');
      const { at, volume } = changes ?? {};
      const checked = {
        ...(at !== undefined ? { at: numberOf(at, 'at', 0, 3600) } : {}),
        ...(volume !== undefined
          ? { volume: numberOf(volume, 'volume', 0, MAX_SOUND_VOLUME) }
          : {}),
      };
      workspace.rememberVideo();
      workspace.changeSound(sound.id, checked);
      return numberOfSound(videoOf(workspace), sound.id);
    },

    /** Where its song begins in the video, how much of the song's start is skipped, how loud it is */
    setMusic: (id: string, changes: { start?: number; trim?: number; volume?: number }) => {
      const workspace = workspaceOf(id);
      const { music } = videoOf(workspace);
      if (music === undefined) {
        throw new Error('Give it a song first');
      }
      const { start, trim, volume } = changes ?? {};
      workspace.rememberVideo();
      workspace.changeMusic({
        ...(start !== undefined ? { start: numberOf(start, 'start', 0, 3600) } : {}),
        ...(trim !== undefined ? { trim: numberOf(trim, 'trim', 0, music.duration) } : {}),
        ...(volume !== undefined ? { volume: numberOf(volume, 'volume', 0, 1) } : {}),
      });
      const changed = videoOf(workspace).music!;
      return { start: changed.start, trim: changed.trim, volume: changed.volume };
    },

    /** Its frame rate (30, 60) and the colour behind everything (any CSS colour) */
    setVideo: (id: string, changes: { fps?: number; background?: string }) => {
      const workspace = workspaceOf(id);
      videoOf(workspace);
      const { fps, background } = changes ?? {};
      const rate = FRAME_RATES.find((r) => r === Number(fps));
      if (fps !== undefined && rate === undefined) {
        throw new Error(`fps is ${FRAME_RATES.join(' or ')}`);
      }
      if (background !== undefined && !CSS.supports('color', String(background))) {
        throw new Error('background is a CSS colour');
      }
      workspace.rememberVideo();
      workspace.setVideoOptions({
        ...(rate !== undefined ? { fps: rate } : {}),
        ...(background !== undefined ? { background: String(background) } : {}),
      });
      return 'changed';
    },

    /** Its song, its beats and swells, and its motions in time, as a PNG as data: to look at the timing */
    soundPicture: (id: string, from?: number, to?: number) => {
      const { video } = workspaceOf(id);
      if (video === undefined) {
        throw new Error('Start its video first');
      }
      return soundPicture(
        video,
        from !== undefined ? Number(from) : 0,
        to !== undefined ? Number(to) : undefined,
      );
    },

    state: (id: string) => {
      const workspace = workspaceOf(id);
      const { video } = workspace;
      const kinds = new Map<string, number>();
      video?.motions.forEach((m) => kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1));
      return {
        id: workspace.id,
        name: workspace.name,
        photos: workspace.fileIds.length,
        texts: workspace.items.slice().filter((item) => item.kind === 'text').length,
        isLocked: workspace.isLocked,
        video:
          video === undefined
            ? undefined
            : {
                size: `${video.width} × ${video.height}`,
                fps: video.fps,
                length: tenths(videoLength(video)),
                isEndSet: video.end !== undefined,
                frame: [video.frame.x, video.frame.y, video.frame.width, video.frame.height].map(
                  Math.round,
                ),
                layouts: video.layouts.length,
                shots: video.camera.length,
                motions: Object.fromEntries(kinds),
                waveCrests: video.motions
                  .filter((m) => m.kind === 'wave')
                  .map((m) => tenths(crestOf(m))),
                song: video.music?.name,
                bpm: video.music !== undefined ? Math.round(video.music.bpm) : undefined,
                swells: videoSwells(video)
                  .filter((s) => s <= videoLength(video))
                  .map(tenths),
              },
      };
    },

    /** Whether the Director is there: what a reload waits for */
    ready: () => true,
  };

  ipcRenderer.on(CALL_CHANNEL, async (_, { id, method, args }) => {
    uiStore.holdScreensaver(DIRECTOR_HOLD);
    let answer: DirectorAnswer;
    try {
      // Its own commands only: never what every object has (`constructor`, `toString`...)
      if (!Object.prototype.hasOwnProperty.call(commands, method)) {
        throw new Error(`No such command: ${method}`);
      }
      answer = { ok: true, result: await commands[method](...args) };
    } catch (e) {
      answer = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    ipcRenderer.send(ANSWER_CHANNEL, { id, answer });
  });
  ipcRenderer.send(READY_CHANNEL);
}
