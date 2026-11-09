import { observable, reaction, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { videoBeats, videoLength } from 'common/video';
import { IconSet } from 'widgets';
import { ClientWorkspace } from '../../entities/Workspace';
import { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { WorkspacePainter } from './paintWorkspace';
import { decodeMusic, playMusic } from './videoMusic';
import { VideoPlayer } from './VideoPlayer';
import Timeline, { LoopCheckbox, PlayTime } from './VideoTimeline';
import { drawFrame, drawingOrder, neededWidths, VideoImages } from './workspaceVideo';

/**
 * The video as it will be saved, over the workspace: drawn by the same `drawFrame` from the same
 * `stateAt`, only smaller and from the thumbnails. Plays in real time from the playhead; paused, it shows
 * the playhead's moment.
 */
const VideoPreview = observer(
  ({
    workspace,
    player,
    sources,
    bottom,
  }: {
    workspace: ClientWorkspace;
    player: VideoPlayer;
    sources: ReadonlyMap<string, WorkspaceImageSource>;
    /** How much of the foot of the workspace the video panel covers: the preview stays above it */
    bottom: number;
  }) => {
    const area = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [images, setImages] = useState<VideoImages>();
    const [size, setSize] = useState({ width: 0, height: 0 });
    const video = workspace.video!;

    // As large as fits on the stage (above the timeline, full window), in the video's shape, in pixels
    // of the screen
    useLayoutEffect(() => {
      const element = stage.current!;
      const fit = () => {
        const aspect = video.width / video.height;
        const margin = player.isFullscreen ? 24 : 48;
        const width = Math.min(
          element.clientWidth - margin,
          (element.clientHeight - margin) * aspect,
        );
        setSize({ width: Math.max(16, width), height: Math.max(16, width / aspect) });
      };
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(element);
      return () => observer.disconnect();
    }, [video.width, video.height, player.isFullscreen, bottom]);

    // The images decoded once for the size they are drawn at. Decoded again only when that changes
    // (`need`: which images, and how large in steps): not when a block is lengthened, the end marker
    // moved or the music made louder
    const pixels = Math.round(size.width * devicePixelRatio);
    // Read when a pass starts: a pass for every pixel the window is made wider was dozens of passes
    const latestPixels = useRef(pixels);
    latestPixels.current = pixels;
    // While the images are being decoded the playhead and the music wait: playing meanwhile was
    // choppy, the decoding taking the frames (the first play of all, which is when they are decoded)
    const [isPreparing] = useState(() => observable.box(false));
    const need = [...neededWidths(video, workspace.items.slice(), pixels)]
      .map(([id, across]) => `${id}:${Math.ceil(across / NEED_STEP)}`)
      .join(',');
    useEffect(() => {
      const width = latestPixels.current;
      if (width <= 16 || workspace.video === undefined) {
        // No pass to wait for: one given up for this would otherwise hold the playhead for good
        runInAction(() => isPreparing.set(false));
        return;
      }
      let isCurrent = true;
      runInAction(() => isPreparing.set(true));
      // The song decoded now too, not when playing begins
      if (workspace.video.music !== undefined) {
        decodeMusic(workspace.video.music.path).catch(() => undefined);
      }
      VideoImages.prepare(
        workspace.video,
        workspace.items.slice(),
        sources,
        width,
        false,
        undefined,
        () => !isCurrent,
      ).then((done) => {
        if (isCurrent) {
          runInAction(() => isPreparing.set(false));
          setImages(done);
        } else {
          done.close();
        }
      });
      // A pass that is no longer wanted stops decoding, and lets go of what it has
      return () => {
        isCurrent = false;
      };
    }, [need, workspace, sources, isPreparing]);
    // The images shown until now let go of once the new ones are drawn (or the preview goes): never
    // before, or the preview would be blank while decoding
    useEffect(() => () => images?.close(), [images]);

    // Drawn whenever the playhead moves or the video changes, and every frame while playing. The video is
    // read as it is at each frame: a change while playing goes on playing
    useEffect(() => {
      const element = canvas.current;
      if (element === null || images === undefined) {
        return;
      }
      element.width = Math.round(size.width * devicePixelRatio);
      element.height = Math.round(size.height * devicePixelRatio);
      const context = element.getContext('2d')!;
      // Before the first frame, which paints over it
      images.warmUpIn(context);
      const paint = new WorkspacePainter(context, element);
      const draw = () => {
        const shown = workspace.video;
        if (shown !== undefined) {
          const items = drawingOrder(workspace.items.slice());
          drawFrame(paint, element, shown, items, images, player.time, videoBeats(shown));
        }
      };
      draw();
      const stopDrawing = reaction(
        () => [player.time, workspace.video, workspace.items.slice()] as const,
        draw,
      );
      let frame: number | undefined;
      let last: number | undefined;
      // Kept by the reaction below: read in every frame, outside of any reaction
      let isWaitingForImages = false;
      const step = (now: number) => {
        // Paused or moved elsewhere since this frame was asked for: the playhead stays where it was put
        if (!player.isPlaying || workspace.video === undefined) {
          frame = undefined;
          return;
        }
        if (last !== undefined && !isWaitingForImages) {
          player.advance((now - last) / 1000, videoLength(workspace.video));
        }
        last = now;
        frame = player.isPlaying ? requestAnimationFrame(step) : undefined;
      };
      // The music along, from where it plays: stopped when it stops (or waits for images), from the
      // start again with a loop, and again from where it is when the song or where it begins changes
      let stopMusic: (() => void) | undefined;
      const stopPlaying = reaction(
        () => [player.isPlaying, player.loops, workspace.video?.music, isPreparing.get()] as const,
        ([isPlaying, , music, isWaiting]) => {
          isWaitingForImages = isWaiting;
          if (isPlaying && frame === undefined) {
            last = undefined;
            frame = requestAnimationFrame(step);
          }
          stopMusic?.();
          stopMusic =
            isPlaying && !isWaiting && music !== undefined
              ? playMusic(music, player.time)
              : undefined;
        },
        { fireImmediately: true },
      );
      return () => {
        stopDrawing();
        stopPlaying();
        stopMusic?.();
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
        }
      };
    }, [images, size, workspace, player, isPreparing]);

    // Full window: the focus on it, so that Space never lands on a button that was focused before
    useEffect(() => {
      if (player.isFullscreen) {
        area.current?.focus({ preventScroll: true });
      }
    }, [player.isFullscreen]);
    // While it plays full window, the bar and the pointer go after a moment of no moving the mouse
    const [isIdle, setIsIdle] = useState(false);
    const idleTimer = useRef<number>();
    const wake = () => {
      setIsIdle(false);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIsIdle(true), IDLE_TIME);
    };
    useEffect(() => () => window.clearTimeout(idleTimer.current), []);
    const length = videoLength(video);
    const togglePlay = () => (player.isPlaying ? player.pause() : player.play(length));

    const preview = (
      <div
        ref={area}
        className="workspace-video-preview"
        data-fullscreen={player.isFullscreen}
        style={player.isFullscreen ? undefined : { bottom }}
        data-idle={player.isFullscreen && player.isPlaying && isIdle}
        data-surface-overlay
        onPointerMove={wake}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            player.close();
          }
        }}
        tabIndex={-1}
      >
        <div ref={stage} className="workspace-video-stage">
          <canvas
            ref={canvas}
            style={{ width: size.width, height: size.height }}
            aria-label="The video at the playhead"
            // Full window, a click on the video plays or pauses it
            onClick={() => player.isFullscreen && togglePlay()}
          />
          {images === undefined && <div className="workspace-spinner" />}
        </div>
        <button className="workspace-video-preview-close btn-icon" onClick={player.close}>
          {IconSet.CLOSE}
          <span>{player.isFullscreen ? 'Back to editing (`)' : 'Back to editing'}</span>
        </button>
        {/* Full window: the timeline of the panel under the video, to watch and scrub */}
        {player.isFullscreen && (
          <div className="workspace-video-playback">
            {/* The controls: playing and the time on top, the options of watching under them */}
            <div className="workspace-video-deck">
              <div className="workspace-video-transport">
                <button
                  className="workspace-video-play btn-icon"
                  data-playing={player.isPlaying}
                  disabled={length === 0}
                  onClick={togglePlay}
                  aria-label={player.isPlaying ? 'Pause' : 'Play'}
                  data-tooltip={player.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                >
                  {player.isPlaying ? IconSet.PAUSE : IconSet.PLAY}
                </button>
                <PlayTime player={player} length={length} />
              </div>
              <div className="workspace-video-deck-options">
                <LoopCheckbox player={player} />
              </div>
            </div>
            <Timeline workspace={workspace} player={player} isSnapping={false} isPlayback />
          </div>
        )}
      </div>
    );
    // Full window: in the app's outer element, which carries the colours of the theme; inside the
    // workspace a fixed element is held to the workspace's box
    const outside = document.getElementById('layout-container');
    return player.isFullscreen && outside !== null ? createPortal(preview, outside) : preview;
  },
);

/** Steps of the size an image is decoded at for the preview, in pixels: a smaller change decodes nothing */
const NEED_STEP = 64;

/** How long the mouse rests before the pointer and the close button of the full-window video go, in ms */
const IDLE_TIME = 2000;

export default VideoPreview;
