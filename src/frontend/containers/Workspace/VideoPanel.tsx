import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { videoLength } from 'common/video';
import { IconSet } from 'widgets';
import { useStore } from '../../contexts/StoreContext';
import { comboMatches, getKeyCombo, parseKeyCombo } from '../../hotkeyParser';
import { ClientWorkspace } from '../../entities/Workspace';
import { VideoPanelTab } from '../../stores/UiStore';
import { VideoPlayer } from './VideoPlayer';
import { BlockSettings, ExportSettings, FormatSettings } from './VideoSettings';
import Timeline, { LoopCheckbox, PlayTime } from './VideoTimeline';

/** The panel is never made taller by itself than this part of the window */
const MOST_OF_WINDOW = 0.6;

const TABS: { tab: VideoPanelTab; name: string }[] = [
  { tab: 'video', name: 'Video' },
  { tab: 'block', name: 'Selected' },
  { tab: 'export', name: 'Export' },
];

/**
 * The panel along the bottom of a workspace in video mode: on top the tabs (the format of the video, the
 * settings of the block selected, saving) and playing, then the settings of the tab, then the timeline
 * with its lanes (camera, layout, motion, music). Its height is dragged by its top edge. With the focus in it, Space plays or
 * pauses, Escape goes back to editing from the preview, Delete takes the selected block off, and the keys
 * of undo and redo work as on the surface.
 */
const VideoPanel = observer(
  ({ workspace, player }: { workspace: ClientWorkspace; player: VideoPlayer }) => {
    const { uiStore } = useStore();
    const panel = useRef<HTMLElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const [isSnapping, setIsSnapping] = useState(true);
    const video = workspace.video;
    const selectedId = workspace.selectedBlock?.id;
    // A block selected: its settings come up
    useEffect(() => {
      if (selectedId !== undefined) {
        uiStore.setVideoPanelTab('block');
      }
    }, [selectedId, uiStore]);
    // Never lower than all of it needs, so nothing is hidden: it opens that tall, grows when the lanes
    // need more (the settings of every tab are as tall: switching tabs changes nothing), and can be made
    // taller by hand but not lower. Measured when the lanes change, not with every frame while playing
    const leastHeight = useRef(0);
    const hasVideo = video !== undefined;
    const motionCount = video?.motions.length ?? 0;
    const isOpening = useRef(true);
    useLayoutEffect(() => {
      const element = panel.current;
      const settings = content.current;
      if (element === null || settings === null) {
        return;
      }
      const fit = () => {
        // As tall as it is with nothing squeezed: measured with its height let go, before anything is drawn
        const { height } = element.style;
        element.style.height = 'auto';
        settings.style.flex = 'none';
        const needed = Math.min(
          element.offsetHeight,
          Math.round(window.innerHeight * MOST_OF_WINDOW),
        );
        element.style.height = height;
        settings.style.flex = '';
        leastHeight.current = needed;
        if (isOpening.current || uiStore.videoPanelHeight < needed) {
          uiStore.setVideoPanelHeight(needed);
        }
        isOpening.current = false;
      };
      fit();
      // The settings taller (another tab or block, a larger zoom, a narrower window): grown along
      const observer = new ResizeObserver(fit);
      observer.observe(settings);
      return () => observer.disconnect();
    }, [hasVideo, motionCount, uiStore]);
    if (video === undefined) {
      return null;
    }
    const length = videoLength(video);
    const togglePlay = () => (player.isPlaying ? player.pause() : player.play(length));
    return (
      <section
        ref={panel}
        className="workspace-video-panel"
        style={{ height: uiStore.videoPanelHeight }}
        aria-label="Video"
        tabIndex={-1}
        // A focused button takes Space on its way up: it would toggle the playing straight back
        onKeyUp={(event) => {
          if (
            event.key === ' ' &&
            !(event.target as HTMLElement).matches('input, select, textarea')
          ) {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          const isTyping = (event.target as HTMLElement).matches('input, select, textarea');
          if (isTyping) {
            return;
          }
          // The panel is beside the surface, not in it: undoing is done here too
          const combo = getKeyCombo(event.nativeEvent);
          const matches = (keys: string) => comboMatches(combo, parseKeyCombo(keys));
          if (event.key === ' ') {
            event.preventDefault();
            togglePlay();
          } else if (event.key === 'Escape' && player.isShowing) {
            player.close();
          } else if (
            (event.key === 'Delete' || event.key === 'Backspace') &&
            workspace.selectedBlock
          ) {
            workspace.removeBlock(workspace.selectedBlock.lane, workspace.selectedBlock.id);
            // The block's element goes: the focus stays here, so undoing it is the next key
            panel.current?.focus();
          } else if (matches(uiStore.hotkeyMap.redo)) {
            event.preventDefault();
            workspace.redo();
          } else if (matches(uiStore.hotkeyMap.undo)) {
            event.preventDefault();
            workspace.undo();
          }
        }}
      >
        <PanelResizer least={leastHeight} />
        {/* On top: playing, the tabs, and snapping */}
        <div className="workspace-video-bar">
          <button
            className="workspace-video-play btn-icon"
            data-playing={player.isPlaying}
            disabled={length === 0}
            onClick={togglePlay}
            data-tooltip={player.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={player.isPlaying ? 'Pause' : 'Play'}
          >
            {player.isPlaying ? IconSet.PAUSE : IconSet.PLAY}
          </button>
          <PlayTime player={player} length={length} />
          <div className="workspace-video-tabs" role="tablist">
            {TABS.map(({ tab, name }) => (
              <button
                key={tab}
                role="tab"
                aria-selected={uiStore.videoPanelTab === tab}
                onClick={() => uiStore.setVideoPanelTab(tab)}
              >
                {name}
              </button>
            ))}
          </div>
          <span className="spacer" />
          {video.music !== undefined && video.music.bpm > 0 && (
            <span className="workspace-video-tempo">{Math.round(video.music.bpm)} BPM</span>
          )}
          <LoopCheckbox player={player} />
          <label
            className="workspace-video-snap"
            data-tooltip="Dragged edges snap to beats, other edges and the playhead (Alt: not)"
          >
            <input
              type="checkbox"
              checked={isSnapping}
              onChange={(event) => setIsSnapping(event.target.checked)}
            />
            Snap
          </label>
        </div>
        {/* The settings of the tab, then the timeline: settings that need more room make the panel taller */}
        <div ref={content} className="workspace-video-tab" role="tabpanel">
          {uiStore.videoPanelTab === 'video' && <FormatSettings workspace={workspace} />}
          {uiStore.videoPanelTab === 'block' && <BlockSettings workspace={workspace} />}
          {uiStore.videoPanelTab === 'export' && <ExportSettings workspace={workspace} />}
        </div>
        <Timeline workspace={workspace} player={player} isSnapping={isSnapping} />
      </section>
    );
  },
);

/** The top edge of the panel: dragged, it makes the panel taller, or lower down to all of it in sight */
const PanelResizer = ({ least }: { least: React.MutableRefObject<number> }) => {
  const { uiStore } = useStore();
  const start = useRef<{ y: number; height: number }>();
  return (
    <div
      className="workspace-video-resizer"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, height: uiStore.videoPanelHeight };
      }}
      onPointerMove={(event) => {
        if (start.current !== undefined) {
          const wanted = start.current.height - (event.clientY - start.current.y);
          uiStore.setVideoPanelHeight(Math.max(least.current, wanted));
        }
      }}
      onPointerUp={() => (start.current = undefined)}
      onPointerCancel={() => (start.current = undefined)}
    />
  );
};

export default VideoPanel;
