import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  ARRIVALS,
  arrivalTimeOf,
  CameraStop,
  endOf,
  frameAround,
  InRow,
  LayoutBlock,
  MUSIC_EXTENSIONS,
  snapTime,
  startsOf,
  STAYS,
  TIMELINE_SECONDS,
  videoBeats,
  videoLength,
} from 'common/video';
import { MOTION_KINDS, Motion } from 'common/video-motion';
import { boundsOf, readingOrder } from 'common/workspace';
import { IconSet } from 'widgets';
import { MenuButton, MenuDivider, MenuItem } from 'widgets/menus';
import { RendererMessenger } from '../../../ipc/renderer';
import { AppToaster } from '../../components/Toaster';
import { ClientWorkspace, MUSIC_ID, VideoLane } from '../../entities/Workspace';
import { useStore } from '../../contexts/StoreContext';
import { decodeMusic, peaksOf } from './videoMusic';
import { VideoPlayer } from './VideoPlayer';
import { formatTime } from './VideoSettings';

/** How tall the ruler and the lanes are, in pixels; the motion lane has a row for each that overlaps */
const SIZES = { ruler: 18, lane: 28, motionRow: 22 };
/** Under the full-window video, where it is only watched: half as tall */
const PLAYBACK_SIZES = { ruler: 12, lane: 14, motionRow: 11 };
/** The most the timeline zooms in: a second as wide as this many pixels */
const MAX_SCALE = 600;
/** How far a block is dragged before it is moved rather than clicked, in pixels */
const DRAG_DISTANCE = 4;
/** How close to a beat, an edge or the playhead a dragged edge snaps to it, in pixels */
const SNAP_PIXELS = 8;

/** What is being dragged on the timeline */
type Drag =
  /** The playhead follows the pointer; playing goes on afterwards when it was playing */
  | { kind: 'scrub'; wasPlaying: boolean }
  /** The end of a camera stop or layout: it lasts until the pointer */
  | { kind: 'edge'; lane: 'camera' | 'layout'; id: string; start: number }
  /** A camera stop or layout, to another place in its row; a click selects it */
  | {
      kind: 'row';
      lane: 'camera' | 'layout';
      id: string;
      x: number;
      hasMoved: boolean;
      start: number;
    }
  /** A motion moved, or its start or end dragged */
  | { kind: 'motion'; part: 'body' | 'start' | 'end'; motion: Motion; x: number; hasMoved: boolean }
  | { kind: 'music'; from: number; x: number; hasMoved: boolean }
  /** The end marker: where the video ends */
  | { kind: 'end' };

/** The id the end marker goes by when edges snap: it does not snap to itself */
const END_ID = 'end';

interface TimelineProps {
  workspace: ClientWorkspace;
  player: VideoPlayer;
  /** Whether dragged edges snap to beats, other edges and the playhead (Alt held: not) */
  isSnapping: boolean;
  /**
   * Under the full-window video: only watched, not edited. The whole video in view at first, no + buttons,
   * and a press anywhere scrubs
   */
  isPlayback?: boolean;
}

/**
 * The timeline of a video: a lane for the camera, the layout, the motions and the music, with a ruler
 * (click or drag to see the video at that moment) and the playhead over them all. At first a minute is in
 * view; the wheel over the timeline moves it left and right, and with Ctrl zooms it in and out around the
 * pointer. The beats of the music are marked on the ruler, and every edge dragged snaps to them.
 * - Camera and layout: blocks one after another from the start. A click selects one (the workspace shows
 *   it, to be changed); its right edge sets how long it lasts; dragged, it goes to another place.
 * - Motions: blocks anywhere in time, in rows where they overlap; dragged, or by their edges.
 * - Music: the song, dragged to where it begins.
 */
const Timeline = observer(({ workspace, player, isSnapping, isPlayback }: TimelineProps) => {
  const video = workspace.video!;
  const timeline = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // Pixels a second: undefined until the timeline is measured, then a minute fills its width
  const [scale, setScale] = useState<number>();
  const drag = useRef<Drag>();
  const [dropAt, setDropAt] = useState<{ lane: 'camera' | 'layout'; index: number }>();
  const length = videoLength(video);
  const musicEnd =
    video.music !== undefined ? video.music.start + video.music.duration - video.music.trim : 0;
  // Room after the end to drag things longer into; watching, the video is all there is
  const span = isPlayback ? Math.max(length, 1) : Math.max(TIMELINE_SECONDS, length + 10, musicEnd);
  const beats = videoBeats(video);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && scale === undefined && element.clientWidth > 0) {
      setScale(element.clientWidth / (isPlayback ? span : TIMELINE_SECONDS));
    }
  });

  // The wheel over the timeline: zoomed never further out than the whole timeline
  useEffect(() => {
    const element = timeline.current;
    const scrolled = scroller.current;
    if (element === null || scrolled === null || scale === undefined) {
      return;
    }
    // The wheel moves the timeline left and right; with Ctrl it magnifies around the pointer (the page's
    // own zoom is kept from it)
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!(event.ctrlKey || event.metaKey)) {
        scrolled.scrollLeft += event.deltaX || event.deltaY;
        return;
      }
      const rect = scrolled.getBoundingClientRect();
      const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      const time = (scrolled.scrollLeft + x) / scale;
      const smallest = rect.width / span;
      const next = Math.min(MAX_SCALE, Math.max(smallest, scale * Math.exp(-event.deltaY * 0.002)));
      setScale(next);
      // The moment under the pointer stays under it (after React has made the track wider or narrower)
      requestAnimationFrame(() => (scrolled.scrollLeft = time * next - x));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scale, span]);

  const pixels = scale ?? 10;
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pixels);
  };
  const cameraStarts = startsOf(video.camera);
  const layoutStarts = startsOf(video.layouts);

  /** Where an edge dragged to `time` lands: on a beat, an edge of another block, or the playhead nearby */
  const snap = (time: number, ownId: string, event: React.PointerEvent) => {
    if (!isSnapping || event.altKey) {
      return time;
    }
    const marks = [0, player.time, ...beats];
    video.camera.forEach(
      (b, i) => b.id !== ownId && marks.push(cameraStarts[i], cameraStarts[i] + b.length),
    );
    video.layouts.forEach(
      (b, i) => b.id !== ownId && marks.push(layoutStarts[i], layoutStarts[i] + b.length),
    );
    video.motions.forEach((m) => m.id !== ownId && marks.push(m.start, m.start + m.length));
    if (ownId !== END_ID) {
      marks.push(length);
    }
    return snapTime(time, marks, SNAP_PIXELS / pixels);
  };

  /** A drag begins: the track follows the pointer from now on, wherever it goes */
  const begin = (event: React.PointerEvent, next: Drag) => {
    event.stopPropagation();
    track.current!.setPointerCapture(event.pointerId);
    if (isPlayback || next.kind === 'scrub') {
      drag.current = { kind: 'scrub', wasPlaying: isPlayback === true && player.isPlaying };
      player.seek(timeAt(event.clientX));
    } else {
      drag.current = next;
    }
  };

  const handleMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (current === undefined) {
      return;
    }
    const time = timeAt(event.clientX);
    switch (current.kind) {
      case 'scrub':
        player.seek(time);
        break;
      case 'edge':
        workspace.setBlockLength(
          current.lane,
          current.id,
          snap(time, current.id, event) - current.start,
        );
        break;
      case 'row': {
        current.hasMoved ||= Math.abs(event.clientX - current.x) >= DRAG_DISTANCE;
        if (current.hasMoved) {
          const blocks = current.lane === 'camera' ? video.camera : video.layouts;
          setDropAt({ lane: current.lane, index: placeAmong(blocks, current.id, time) });
        }
        break;
      }
      case 'motion': {
        current.hasMoved ||= Math.abs(event.clientX - current.x) >= DRAG_DISTANCE;
        if (!current.hasMoved) {
          break;
        }
        const { motion } = current;
        const moved = (event.clientX - current.x) / pixels;
        if (current.part === 'body') {
          // Its start snaps to a mark nearby; if none is near, its end does
          const start = motion.start + moved;
          const snappedStart = snap(start, motion.id, event);
          workspace.changeMotion(motion.id, {
            start:
              snappedStart !== start
                ? snappedStart
                : snap(start + motion.length, motion.id, event) - motion.length,
          });
        } else if (current.part === 'start') {
          const end = motion.start + motion.length;
          // Never before the start of the video: it would come back longer than it was
          const start = Math.max(
            0,
            Math.min(end - 0.1, snap(motion.start + moved, motion.id, event)),
          );
          workspace.changeMotion(motion.id, { start, length: end - start });
        } else {
          const end = snap(motion.start + motion.length + moved, motion.id, event);
          workspace.changeMotion(motion.id, { length: end - motion.start });
        }
        break;
      }
      case 'end':
        workspace.setVideoEnd(snap(time, END_ID, event));
        break;
      case 'music': {
        current.hasMoved ||= Math.abs(event.clientX - current.x) >= DRAG_DISTANCE;
        if (current.hasMoved) {
          const start = current.from + (event.clientX - current.x) / pixels;
          workspace.changeMusic({ start: Math.max(0, snap(start, MUSIC_ID, event)) });
        }
        break;
      }
    }
  };

  const handleUp = () => {
    const current = drag.current;
    drag.current = undefined;
    setDropAt(undefined);
    if (current?.kind === 'scrub' && current.wasPlaying) {
      player.play(length);
    } else if (current?.kind === 'row') {
      if (current.hasMoved) {
        if (dropAt !== undefined) {
          workspace.moveBlock(current.lane, current.id, dropAt.index);
        }
      } else {
        select(current.lane, current.id, current.start);
      }
    } else if (current?.kind === 'motion' && !current.hasMoved) {
      select('motion', current.motion.id, current.motion.start);
    } else if (current?.kind === 'music' && !current.hasMoved) {
      select('music', MUSIC_ID, video.music?.start ?? 0);
    }
  };

  /**
   * A block selected: shown on the workspace (not in the preview), the playhead at its start. The camera
   * stop that is selected already, clicked again, is let go of: no shot selected, the view staying where
   * it is (as after a click on a layout)
   */
  const select = (lane: VideoLane, id: string, start: number) => {
    player.close();
    if (lane === 'camera' && workspace.selectedBlock?.id === id) {
      workspace.clearBlockSelection();
      return;
    }
    player.moveTo(start);
    workspace.selectBlock(lane, id);
  };

  const isSelected = (id: string) =>
    !isPlayback && workspace.selectedBlock?.id === id && !player.isShowing;
  const motionRows = rowsOf(video.motions);
  const height = isPlayback ? PLAYBACK_SIZES : SIZES;
  const motionHeight = Math.max(1, motionRows.count) * height.motionRow + (isPlayback ? 2 : 4);
  const step = tickStep(pixels);
  const beatStep = Math.max(1, Math.ceil(5 / (pixels * beatSpacing(beats))));

  return (
    <div ref={timeline} className="workspace-video-timeline" data-playback={isPlayback === true}>
      {isPlayback ? (
        <div className="workspace-video-lane-names">
          <div style={{ height: height.ruler }} />
          <LaneName name="Camera" height={height.lane} />
          <LaneName name="Layout" height={height.lane} />
          <LaneName name="Motion" height={motionHeight} />
          <LaneName name="Music" height={height.lane} />
        </div>
      ) : (
        <div className="workspace-video-lane-names">
          <div style={{ height: height.ruler }} />
          <CameraLaneName workspace={workspace} />
          <LaneName name="Layout" detail="Optional: without it, the layout stays as it is">
            <button
              className="btn-icon"
              data-tooltip="Add the layout as it is now"
              aria-label="Add layout"
              onClick={() => {
                player.close();
                workspace.addLayout();
              }}
            >
              {IconSet.PLUS}
            </button>
          </LaneName>
          <MotionLaneName workspace={workspace} player={player} height={motionHeight} />
          <MusicLaneName workspace={workspace} />
        </div>
      )}
      <div ref={scroller} className="workspace-video-scroller">
        <div
          ref={track}
          className="workspace-video-track"
          style={{ width: span * pixels }}
          // Watching, a press on an empty part of a lane scrubs too
          onPointerDown={
            isPlayback ? (event) => begin(event, { kind: 'scrub', wasPlaying: false }) : undefined
          }
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        >
          <div
            className="workspace-video-ruler"
            style={{ height: height.ruler }}
            onPointerDown={(event) => begin(event, { kind: 'scrub', wasPlaying: false })}
          >
            {beats
              .filter((_, i) => i % beatStep === 0)
              .map((beat) => (
                <i key={beat} style={{ left: beat * pixels }} />
              ))}
            {Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => (
              <span key={i} style={{ left: i * step * pixels }}>
                {formatTick(i * step)}
              </span>
            ))}
          </div>

          <div className="workspace-video-lane" style={{ height: height.lane }}>
            {video.camera.map((stop, i) => (
              <RowBlock
                key={stop.id}
                block={stop}
                start={cameraStarts[i]}
                pixels={pixels}
                lead={i === 0 ? 0 : arrivalTimeOf(stop)}
                isSelected={isSelected(stop.id)}
                isDragged={
                  drag.current?.kind === 'row' &&
                  drag.current.id === stop.id &&
                  dropAt !== undefined
                }
                onPress={(event) =>
                  begin(event, {
                    kind: 'row',
                    lane: 'camera',
                    id: stop.id,
                    x: event.clientX,
                    hasMoved: false,
                    start: cameraStarts[i],
                  })
                }
                onEdge={(event) =>
                  begin(event, {
                    kind: 'edge',
                    lane: 'camera',
                    id: stop.id,
                    start: cameraStarts[i],
                  })
                }
              >
                <strong>
                  {i === 0 ? 'Start' : ARRIVALS.find((a) => a.arrival === stop.arrival)!.name}
                </strong>
                <small>
                  {STAYS.find((s) => s.stay === stop.stay)!.name} · {stop.length.toFixed(1)} s
                </small>
              </RowBlock>
            ))}
            {video.camera.length === 0 && (
              <span className="workspace-video-lane-hint">
                Press + to make the dotted frame the first shot
              </span>
            )}
          </div>

          <div className="workspace-video-lane" style={{ height: height.lane }}>
            {video.layouts.map((layout, i) => (
              <RowBlock
                key={layout.id}
                block={layout}
                start={layoutStarts[i]}
                pixels={pixels}
                lead={i === 0 ? 0 : Math.min(layout.transition, layout.length)}
                isSelected={isSelected(layout.id)}
                isDragged={
                  drag.current?.kind === 'row' &&
                  drag.current.id === layout.id &&
                  dropAt !== undefined
                }
                onPress={(event) =>
                  begin(event, {
                    kind: 'row',
                    lane: 'layout',
                    id: layout.id,
                    x: event.clientX,
                    hasMoved: false,
                    start: layoutStarts[i],
                  })
                }
                onEdge={(event) =>
                  begin(event, {
                    kind: 'edge',
                    lane: 'layout',
                    id: layout.id,
                    start: layoutStarts[i],
                  })
                }
              >
                <strong>Layout {i + 1}</strong>
                <small>
                  {Object.keys(layout.poses).length} objects · {layout.length.toFixed(1)} s
                </small>
              </RowBlock>
            ))}
          </div>

          <div className="workspace-video-lane" style={{ height: motionHeight }}>
            {video.motions.map((motion) => (
              <div
                key={motion.id}
                className="workspace-video-block workspace-video-motion"
                data-group={MOTION_KINDS.find((m) => m.kind === motion.kind)!.group}
                aria-current={isSelected(motion.id)}
                style={{
                  left: motion.start * pixels,
                  width: motion.length * pixels,
                  top:
                    (isPlayback ? 1 : 2) +
                    (motionRows.rowOf.get(motion.id) ?? 0) * height.motionRow,
                  height: height.motionRow - (isPlayback ? 2 : 3),
                }}
                onPointerDown={(event) =>
                  begin(event, {
                    kind: 'motion',
                    part: 'body',
                    motion,
                    x: event.clientX,
                    hasMoved: false,
                  })
                }
              >
                <span className="workspace-video-block-name">
                  <strong>{MOTION_KINDS.find((m) => m.kind === motion.kind)!.name}</strong>
                  <small>× {motion.targets.length}</small>
                </span>
                <span
                  className="workspace-video-edge"
                  data-side="start"
                  onPointerDown={(event) =>
                    begin(event, {
                      kind: 'motion',
                      part: 'start',
                      motion,
                      x: event.clientX,
                      hasMoved: true,
                    })
                  }
                />
                <span
                  className="workspace-video-edge"
                  data-side="end"
                  onPointerDown={(event) =>
                    begin(event, {
                      kind: 'motion',
                      part: 'end',
                      motion,
                      x: event.clientX,
                      hasMoved: true,
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="workspace-video-lane" style={{ height: height.lane }}>
            {video.music !== undefined && (
              <div
                className="workspace-video-block workspace-video-music"
                aria-current={isSelected(MUSIC_ID)}
                style={{
                  left: video.music.start * pixels,
                  width: Math.max(1, video.music.duration - video.music.trim) * pixels,
                }}
                onPointerDown={(event) =>
                  begin(event, {
                    kind: 'music',
                    from: video.music!.start,
                    x: event.clientX,
                    hasMoved: false,
                  })
                }
              >
                <Waveform
                  file={video.music.path}
                  trim={video.music.trim}
                  duration={video.music.duration}
                  width={(video.music.duration - video.music.trim) * pixels}
                />
                <span className="workspace-video-block-name">
                  <strong>{video.music.name}</strong>
                  <small>
                    {video.music.bpm > 0 ? `${Math.round(video.music.bpm)} beats a minute` : ''}
                  </small>
                </span>
              </div>
            )}
          </div>

          {dropAt !== undefined && (
            <div
              className="workspace-video-drop"
              style={{
                left:
                  dropPlace(dropAt.lane === 'camera' ? video.camera : video.layouts, dropAt.index) *
                  pixels,
                top: height.ruler + (dropAt.lane === 'camera' ? 0 : height.lane),
                height: height.lane,
              }}
            />
          )}
          <div className="workspace-video-playhead" style={{ left: player.time * pixels }} />
          {/* Where the video ends, and so what is saved: a triangle on the ruler, dragged to move it */}
          <div className="workspace-video-end" style={{ left: length * pixels }}>
            <span
              className="workspace-video-end-handle"
              data-tooltip={
                isPlayback ? undefined : `End of the video: ${formatTime(length)}. Drag to move it`
              }
              onPointerDown={(event) => begin(event, { kind: 'end' })}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * Where the playhead is, and how long the video is. Of its own, as it changes in every frame while
 * playing: what it is in (the panel, the full-window player) is not drawn again with it
 */
export const PlayTime = observer(({ player, length }: { player: VideoPlayer; length: number }) => (
  <span className="workspace-video-time">
    {formatTime(player.time)} <span>/ {formatTime(length)}</span>
  </span>
));

/** Whether playing starts over at the end marker: beside the timeline, in the panel and full window */
export const LoopCheckbox = observer(({ player }: { player: VideoPlayer }) => (
  <label
    className="workspace-video-snap"
    data-tooltip="Play from the start again at the end marker"
  >
    <input
      type="checkbox"
      checked={player.isLooping}
      onChange={(event) => player.setLooping(event.target.checked)}
    />
    Loop
  </label>
));

/** A camera stop or a layout on its lane: its lead in striped (the move there), its end dragged */
const RowBlock = ({
  block,
  start,
  pixels,
  lead,
  isSelected,
  isDragged,
  onPress,
  onEdge,
  children,
}: {
  block: InRow;
  start: number;
  pixels: number;
  /** The seconds at its start that are a move into it */
  lead: number;
  isSelected: boolean;
  isDragged: boolean;
  onPress: (event: React.PointerEvent) => void;
  onEdge: (event: React.PointerEvent) => void;
  children: React.ReactNode;
}) => (
  <div
    className="workspace-video-block"
    aria-current={isSelected}
    data-dragged={isDragged}
    style={{ left: start * pixels, width: block.length * pixels }}
    onPointerDown={onPress}
  >
    {lead > 0 && <span className="workspace-video-move" style={{ width: lead * pixels }} />}
    <span className="workspace-video-block-name">{children}</span>
    <span
      className="workspace-video-edge"
      data-side="end"
      data-tooltip="Drag to change how long it lasts"
      onPointerDown={onEdge}
    />
  </div>
);

/** The name of a lane, with what adds to it */
const LaneName = ({
  name,
  detail,
  height = SIZES.lane,
  children,
}: {
  name: string;
  detail?: string;
  height?: number;
  children?: React.ReactNode;
}) => (
  <div className="workspace-video-lane-name" style={{ height }} data-tooltip={detail}>
    <span>{name}</span>
    {children}
  </div>
);

/** The camera: a shot beside the one selected (to be moved where wanted), or framing what is selected */
const CameraLaneName = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const video = workspace.video!;
  const selected = workspace.items.slice().filter((item) => workspace.selection.has(item.id));
  const bounds = boundsOf(selected);
  return (
    <LaneName name="Camera">
      <button
        className="btn-icon"
        data-tooltip="Add a shot, beside the one selected, to move where you want it"
        aria-label="Add camera stop"
        onClick={() => workspace.addCameraStop()}
      >
        {IconSet.PLUS}
      </button>
      <button
        className="btn-icon"
        data-tooltip={
          bounds !== undefined
            ? 'Add a stop framing what is selected'
            : 'Select photos to frame them'
        }
        aria-label="Add a stop framing what is selected"
        disabled={bounds === undefined}
        onClick={() =>
          bounds !== undefined &&
          workspace.addCameraStop(frameAround(bounds, video.width / video.height))
        }
      >
        {IconSet.FIT}
      </button>
    </LaneName>
  );
});

/**
 * Motions: put on what is selected on the workspace, from the playhead. The menu lists them in three
 * groups, apart by lines: coming in, while seen, going out
 */
const MotionLaneName = observer(
  ({
    workspace,
    player,
    height,
  }: {
    workspace: ClientWorkspace;
    player: VideoPlayer;
    height: number;
  }) => {
    const items = workspace.items
      .slice()
      .filter((item) => workspace.selection.has(item.id) && item.kind !== 'background');
    // In reading order: a stagger goes along the rows
    const targets = readingOrder(items).map((item) => item.id);
    return (
      <LaneName name="Motion" height={height}>
        <MenuButton
          id="__video-add-motion"
          menuID="__video-add-motion-options"
          icon={IconSet.PLUS}
          text="Add motion"
          // No tooltip: it stayed over the lane once the menu had closed, covering the new block
          disabled={targets.length === 0}
        >
          {(['enter', 'during', 'exit'] as const).flatMap((group, i) => [
            ...(i > 0 ? [<MenuDivider key={`${group}-divider`} />] : []),
            ...MOTION_KINDS.filter((m) => m.group === group).map((m) => (
              <MenuItem
                key={m.kind}
                text={m.name}
                onClick={() => workspace.addMotion(m.kind, targets, player.time)}
              />
            )),
          ])}
        </MenuButton>
      </LaneName>
    );
  },
);

/** Music: a song from anywhere on the computer (it is only read), its beats found */
const MusicLaneName = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const { workspaceStore } = useStore();
  const [isFinding, setIsFinding] = useState(false);
  const add = async () => {
    const { filePaths } = await RendererMessenger.showOpenDialog({
      title: 'Choose a song for the video',
      filters: [{ name: 'Music', extensions: MUSIC_EXTENSIONS }],
      properties: ['openFile'],
    });
    if (filePaths.length === 0) {
      return;
    }
    setIsFinding(true);
    AppToaster.show({ message: 'Finding the beats of the song…', timeout: 0 }, 'video-music');
    try {
      const music = await workspaceStore.addMusic(workspace, filePaths[0]);
      AppToaster.show(
        {
          message:
            music.bpm > 0
              ? `${music.name}: ${Math.round(music.bpm)} beats a minute`
              : `${music.name}: no steady beat found`,
          timeout: 5000,
        },
        'video-music',
      );
    } catch (e) {
      console.error('Could not read the song', e);
      AppToaster.show({ message: 'That song could not be read.', timeout: 6000 }, 'video-music');
    } finally {
      setIsFinding(false);
    }
  };
  return (
    <LaneName name="Music" detail="The edges you drag snap to its beats">
      <button
        className="btn-icon"
        data-tooltip={workspace.video?.music !== undefined ? 'Use another song' : 'Add a song'}
        aria-label="Add music"
        disabled={isFinding}
        onClick={add}
      >
        {IconSet.PLUS}
      </button>
    </LaneName>
  );
});

/** The shape of the song, drawn once it is decoded */
const Waveform = ({
  file,
  trim,
  duration,
  width,
}: {
  file: string;
  trim: number;
  duration: number;
  width: number;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  // A canvas no wider than this; stretched beyond
  const pixels = Math.max(1, Math.min(4096, Math.round(width)));
  useEffect(() => {
    let isCurrent = true;
    decodeMusic(file)
      .then((buffer) => {
        const element = canvas.current;
        if (!isCurrent || element === null) {
          return;
        }
        const total = Math.max(
          1,
          Math.round((pixels * duration) / Math.max(1e-3, duration - trim)),
        );
        const peaks = peaksOf(buffer, total).subarray(total - pixels);
        element.width = pixels;
        element.height = 32;
        const context = element.getContext('2d')!;
        context.clearRect(0, 0, element.width, element.height);
        context.fillStyle = getComputedStyle(element).color;
        peaks.forEach((peak, x) => {
          const h = Math.max(1, peak * 30);
          context.fillRect(x, 16 - h / 2, 1, h);
        });
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [file, trim, duration, pixels]);
  return <canvas ref={canvas} className="workspace-video-waveform" />;
};

/** The motions put in rows: each in the first row where it overlaps nothing */
function rowsOf(motions: readonly Motion[]): { rowOf: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rowOf = new Map<string, number>();
  [...motions]
    .sort((a, b) => a.start - b.start)
    .forEach((motion) => {
      let row = ends.findIndex((end) => end <= motion.start + 1e-6);
      if (row === -1) {
        row = ends.length;
        ends.push(0);
      }
      ends[row] = motion.start + motion.length;
      rowOf.set(motion.id, row);
    });
  return { rowOf, count: ends.length };
}

/** Where a block dragged to `time` goes in its row: before the first other whose middle is past it */
function placeAmong(blocks: readonly InRow[], id: string, time: number): number {
  const starts = startsOf(blocks);
  let place = 0;
  blocks.forEach((block, i) => {
    if (block.id !== id && starts[i] + block.length / 2 < time) {
      place++;
    }
  });
  return place;
}

/** Where on the timeline a place in a row is (the dragged block not counted, as `moveInRow` counts) */
function dropPlace(blocks: readonly (CameraStop | LayoutBlock)[], index: number): number {
  const starts = startsOf(blocks);
  return index < starts.length ? starts[index] : endOf(blocks);
}

/** The usual time between beats, in seconds */
function beatSpacing(beats: readonly number[]): number {
  return beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 1;
}

/** Seconds between the marks of the ruler: about 80 pixels apart at least */
function tickStep(pixelsPerSecond: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((step) => step * pixelsPerSecond >= 80) ?? 600;
}

/** A mark of the ruler: 5s, 1:30 */
function formatTick(seconds: number): string {
  if (seconds < 60) {
    return `${Number(seconds.toFixed(1))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

export default Timeline;
