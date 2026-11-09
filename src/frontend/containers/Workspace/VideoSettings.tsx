import { observer } from 'mobx-react-lite';
import React, { useRef, useState } from 'react';

import { EDIT_STYLES, EditStyle } from 'common/auto-edit';
import { fileNameOf } from 'common/export';
import {
  ARRIVALS,
  EASINGS,
  Easing,
  FRAME_RATES,
  FrameRate,
  MIN_BLOCK_LENGTH,
  outputSize,
  STAYS,
  VIDEO_FORMATS,
  videoLength,
  videoSize,
  VideoSize,
} from 'common/video';
import { MOTION_KINDS, MotionKind } from 'common/video-motion';
import { readingOrder } from 'common/workspace';
import { Button, IconSet } from 'widgets';
import { RendererMessenger } from '../../../ipc/renderer';
import { useStore } from '../../contexts/StoreContext';
import { ClientWorkspace, MUSIC_ID } from '../../entities/Workspace';

/** The folder videos were saved in last, where the folder dialog opens the next time */
const LAST_FOLDER_KEY = 'Atlas_WorkspaceVideoFolder';

/** A time as a clock shows it: 0:03.2 */
export function formatTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** The format and rate of the video, and what is behind everything */
export const FormatSettings = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const video = workspace.video!;
  const preset = VIDEO_FORMATS.findIndex(
    (format) => format.width === video.width && format.height === video.height,
  );
  const [isCustom, setIsCustom] = useState(preset === -1);
  return (
    <div className="workspace-video-settings">
      <div className="workspace-video-row">
        <label>
          <span>Format</span>
          <select
            className="wide"
            value={isCustom ? 'custom' : String(preset)}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setIsCustom(true);
              } else {
                setIsCustom(false);
                workspace.setVideoSize(VIDEO_FORMATS[Number(event.target.value)]);
              }
            }}
          >
            {VIDEO_FORMATS.map((format, i) => (
              <option key={format.name} value={i}>
                {format.name}
              </option>
            ))}
            <option value="custom">Custom size</option>
          </select>
        </label>
        {isCustom && (
          // Made anew when the size changes elsewhere (undo, the Director), so its fields show it
          <CustomSize key={`${video.width}×${video.height}`} workspace={workspace} />
        )}
        <label>
          <span>Frames a second</span>
          <select
            value={video.fps}
            onChange={(event) =>
              workspace.setVideoOptions({ fps: Number(event.target.value) as FrameRate })
            }
          >
            {FRAME_RATES.map((fps) => (
              <option key={fps} value={fps}>
                {fps}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Background</span>
          <input
            type="color"
            value={video.background}
            onChange={(event) => workspace.setVideoOptions({ background: event.target.value })}
          />
        </label>
      </div>
      <CutToTheBeat workspace={workspace} />
    </div>
  );
});

/**
 * The video's shots and motions made anew on the beats of its song (`cutToTheBeat`), in a style; every
 * press another edit of the same photos. Replaces the shots and motions there were: one undo puts them back
 */
const CutToTheBeat = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const [style, setStyle] = useState<EditStyle>('cuts');
  const hasPhotos = workspace.fileIds.length > 0;
  return (
    <div className="workspace-video-row">
      <label>
        <span>Cut to the beat</span>
        <Choices
          options={EDIT_STYLES.map((s) => ({ value: s.style, name: s.name, detail: s.detail }))}
          value={style}
          onChange={setStyle}
        />
      </label>
      <div className="workspace-video-actions">
        <Button
          icon={IconSet.SHUFFLE}
          text="Cut to the beat"
          tooltip={
            hasPhotos
              ? 'New shots and motions on the beats, another at every press (Ctrl+Z puts back what was)'
              : 'Put photos on the workspace first'
          }
          disabled={!hasPhotos}
          onClick={() => workspace.cutToTheBeat(style, Math.floor(Math.random() * 2 ** 31))}
        />
      </div>
    </div>
  );
});

/** A size of one's own: taken when it is let go of (Enter, or leaving the field), made even and within limits */
const CustomSize = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const video = workspace.video!;
  const [width, setWidth] = useState(String(video.width));
  const [height, setHeight] = useState(String(video.height));
  const apply = () => {
    const size = videoSize(Number(width), Number(height));
    setWidth(String(size.width));
    setHeight(String(size.height));
    workspace.setVideoSize(size);
  };
  const field = (value: string, set: (value: string) => void, name: string) => (
    <input
      type="number"
      min={16}
      step={2}
      aria-label={name}
      value={value}
      onChange={(event) => set(event.target.value)}
      onBlur={apply}
      onKeyDown={(event) => event.key === 'Enter' && apply()}
    />
  );
  return (
    <label data-tooltip="Up to about 1920 × 1080 pixels">
      <span>Size</span>
      <div className="workspace-video-size">
        {field(width, setWidth, 'Width')}
        <span>×</span>
        {field(height, setHeight, 'Height')}
      </div>
    </label>
  );
});

/** A number of seconds, taken as it is typed */
const Seconds = ({
  value,
  onChange,
  min = 0,
  disabled,
}: {
  value: number;
  onChange: (seconds: number) => void;
  min?: number;
  disabled?: boolean;
}) => (
  <input
    type="number"
    min={min}
    max={600}
    step={0.1}
    value={Number(value.toFixed(2))}
    disabled={disabled}
    onChange={(event) => {
      const n = Number(event.target.value);
      if (Number.isFinite(n) && n >= min) {
        onChange(Math.min(600, n));
      }
    }}
  />
);

/**
 * A place on the workspace, in its pixels: typed, or nudged by one with ↑ and ↓. Everything done while
 * the field has the focus is one change to undo (`isContinuing` from the second step on)
 */
const Coordinate = ({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number, isContinuing: boolean) => void;
}) => {
  const isContinuing = useRef(false);
  return (
    <label data-tooltip={hint}>
      <span>{label}</span>
      <input
        type="number"
        step={1}
        value={Math.round(value)}
        onFocus={() => (isContinuing.current = false)}
        onChange={(event) => {
          const n = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(n)) {
            onChange(Math.round(n), isContinuing.current);
            isContinuing.current = true;
          }
        }}
      />
    </label>
  );
};

/** A slider with its value after it as a percentage */
const Percent = ({
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) => (
  <>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
    <output>{Math.round(value * 100)}%</output>
  </>
);

/** Choices as a row of buttons, the chosen one pressed */
function Choices<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; name: string; detail?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="workspace-video-choices" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          data-tooltip={option.detail}
          onClick={() => onChange(option.value)}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}

const EasingChoice = ({
  value,
  onChange,
}: {
  value: Easing;
  onChange: (easing: Easing) => void;
}) => (
  <label>
    <span>Easing</span>
    <select value={value} onChange={(event) => onChange(event.target.value as Easing)}>
      {EASINGS.map(({ easing, name }) => (
        <option key={easing} value={easing}>
          {name}
        </option>
      ))}
    </select>
  </label>
);

/** The settings of the block selected on the timeline: a camera stop, a layout, a motion or the music */
export const BlockSettings = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const video = workspace.video!;
  const selected = workspace.selectedBlock;
  const remove = selected !== undefined && (
    <Button
      icon={IconSet.DELETE}
      text="Remove"
      onClick={(event) => {
        // This button goes with the block: the focus stays in the panel, so undoing it is the next key
        (event.currentTarget.closest('.workspace-video-panel') as HTMLElement | null)?.focus();
        workspace.removeBlock(selected.lane, selected.id);
      }}
    />
  );

  // Each kind in two rows: how it moves on top, how long and what to do with it under that
  if (selected?.lane === 'camera') {
    const index = video.camera.findIndex((stop) => stop.id === selected.id);
    const stop = video.camera[index];
    if (stop !== undefined) {
      const change = (changes: Parameters<typeof workspace.changeCameraStop>[1]) =>
        workspace.changeCameraStop(stop.id, changes);
      const lasts = (
        <label>
          <span>Lasts</span>
          <Seconds
            value={stop.length}
            min={0.1}
            onChange={(length) => workspace.setBlockLength('camera', stop.id, length)}
          />
        </label>
      );
      const whileThere = (
        <label>
          <span>While there</span>
          <Choices
            options={STAYS.map((s) => ({ value: s.stay, name: s.name, detail: s.detail }))}
            value={stop.stay}
            onChange={(stay) => change({ stay })}
          />
        </label>
      );
      // Where the shot is: its top left corner on the workspace
      const place = (
        <>
          <Coordinate
            label="X"
            hint="Left edge of the shot (↑ ↓ move it by one)"
            value={stop.frame.x}
            onChange={(x, isContinuing) =>
              workspace.setShotFrame(stop.id, { ...stop.frame, x }, isContinuing)
            }
          />
          <Coordinate
            label="Y"
            hint="Top edge of the shot (↑ ↓ move it by one)"
            value={stop.frame.y}
            onChange={(y, isContinuing) =>
              workspace.setShotFrame(stop.id, { ...stop.frame, y }, isContinuing)
            }
          />
        </>
      );
      // The shot is locked once selected: this frees it to be moved and sized on the workspace
      const actions = (
        <div className="workspace-video-actions">
          {workspace.isEditingShot ? (
            <Button
              icon={IconSet.LOCK}
              text="Lock shot"
              styling="filled"
              tooltip="The shot stays where it is (Enter)"
              onClick={workspace.lockShot}
            />
          ) : (
            <Button
              icon={IconSet.UNLOCK}
              text="Edit shot"
              tooltip="Move and size the shot on the workspace"
              onClick={workspace.editShot}
            />
          )}
          {remove}
        </div>
      );
      // The first stop is where the video begins: nothing to get there
      if (index === 0) {
        return (
          <div className="workspace-video-settings">
            <div className="workspace-video-row">
              {whileThere}
              {lasts}
              {place}
              {actions}
            </div>
          </div>
        );
      }
      return (
        <div className="workspace-video-settings">
          <div className="workspace-video-row">
            <label>
              <span>Getting there</span>
              <Choices
                options={ARRIVALS.map((a) => ({
                  value: a.arrival,
                  name: a.name,
                  detail: a.detail,
                }))}
                value={stop.arrival}
                onChange={(arrival) => change({ arrival })}
              />
            </label>
            {(stop.arrival === 'glide' || stop.arrival === 'whip') && (
              <label>
                <span>Taking</span>
                <Seconds
                  value={stop.arrivalTime}
                  min={0.1}
                  onChange={(arrivalTime) => change({ arrivalTime })}
                />
              </label>
            )}
            {stop.arrival === 'glide' && (
              <EasingChoice value={stop.easing} onChange={(easing) => change({ easing })} />
            )}
          </div>
          <div className="workspace-video-row">
            {whileThere}
            {lasts}
            {place}
            {actions}
          </div>
        </div>
      );
    }
  }

  if (selected?.lane === 'layout') {
    const index = video.layouts.findIndex((layout) => layout.id === selected.id);
    const layout = video.layouts[index];
    if (layout !== undefined) {
      return (
        <div className="workspace-video-settings">
          <div className="workspace-video-row">
            {index > 0 && (
              <label>
                <span>Gliding here</span>
                <Seconds
                  value={layout.transition}
                  onChange={(transition) => workspace.changeLayout(layout.id, { transition })}
                />
              </label>
            )}
            {index > 0 && (
              <EasingChoice
                value={layout.easing}
                onChange={(easing) => workspace.changeLayout(layout.id, { easing })}
              />
            )}
          </div>
          <div className="workspace-video-row">
            <label>
              <span>Lasts</span>
              <Seconds
                value={layout.length}
                min={0.1}
                onChange={(length) => workspace.setBlockLength('layout', layout.id, length)}
              />
            </label>
            <div className="workspace-video-actions">{remove}</div>
          </div>
        </div>
      );
    }
  }

  if (selected?.lane === 'motion') {
    const motion = video.motions.find((m) => m.id === selected.id);
    if (motion !== undefined) {
      const change = (changes: Parameters<typeof workspace.changeMotion>[1]) =>
        workspace.changeMotion(motion.id, changes);
      const chosen = readingOrder(
        workspace.items
          .slice()
          .filter((i) => workspace.selection.has(i.id) && i.kind !== 'background'),
      ).map((i) => i.id);
      return (
        <div className="workspace-video-settings">
          <div className="workspace-video-row">
            <label
              data-tooltip={`Moves ${motion.targets.length} ${
                motion.targets.length === 1 ? 'object' : 'objects'
              }`}
            >
              <span>Motion</span>
              <select
                value={motion.kind}
                onChange={(event) => change({ kind: event.target.value as MotionKind })}
              >
                {MOTION_KINDS.map((m) => (
                  <option key={m.kind} value={m.kind}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Strength</span>
              <Percent
                value={motion.strength}
                min={0}
                max={2}
                onChange={(strength) => change({ strength })}
              />
            </label>
            <label>
              <span>Speed</span>
              <Percent
                value={motion.speed}
                min={0.25}
                max={3}
                onChange={(speed) => change({ speed })}
              />
            </label>
          </div>
          <div className="workspace-video-row">
            <label>
              <span>From</span>
              <Seconds value={motion.start} onChange={(start) => change({ start })} />
            </label>
            <label>
              <span>Lasts</span>
              <Seconds value={motion.length} min={0.1} onChange={(length) => change({ length })} />
            </label>
            {motion.targets.length > 1 && (
              <label>
                <span>One after another</span>
                <Seconds
                  value={motion.stagger}
                  onChange={(stagger) => change({ stagger: Math.min(2, stagger) })}
                />
              </label>
            )}
            <div className="workspace-video-actions">
              <Button
                icon={IconSet.SELECT_CHECKED}
                text={`Use selection (${chosen.length})`}
                disabled={chosen.length === 0}
                onClick={() => change({ targets: chosen })}
              />
              {remove}
            </div>
          </div>
        </div>
      );
    }
  }

  if (selected?.lane === 'music' && selected.id === MUSIC_ID && video.music !== undefined) {
    const { music } = video;
    return (
      <div className="workspace-video-settings">
        <div className="workspace-video-row">
          <label>
            <span>Song</span>
            <strong className="workspace-video-song">{music.name}</strong>
          </label>
          <label>
            <span>Tempo</span>
            <strong>
              {music.bpm > 0 ? `${Math.round(music.bpm)} beats a minute` : 'no steady beat'}
            </strong>
          </label>
        </div>
        <div className="workspace-video-row">
          <label>
            <span>Volume</span>
            <Percent
              value={music.volume}
              min={0}
              max={1}
              step={0.01}
              onChange={(volume) => workspace.changeMusic({ volume })}
            />
          </label>
          <label>
            <span>Begins at</span>
            <Seconds value={music.start} onChange={(start) => workspace.changeMusic({ start })} />
          </label>
          <label>
            <span>Skip the first</span>
            <Seconds value={music.trim} onChange={(trim) => workspace.changeMusic({ trim })} />
          </label>
          <div className="workspace-video-actions">{remove}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="workspace-video-placeholder"
      data-tooltip="Add camera stops with the + of the Camera lane, motions for photos you select, and a song to cut to its beats"
    >
      <strong>Nothing selected</strong>
      <span>Click a block on the timeline to change it here</span>
    </div>
  );
});

/**
 * Where the video ends, in seconds: the end marker of the timeline, which it follows while it is dragged.
 * Taken as it is typed, as soon as it is a time; what is typed stays until the field is left, so that
 * "0." on the way to "0.5" is not put back to what the marker says
 */
const EndField = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const video = workspace.video!;
  const [typed, setTyped] = useState<string>();
  const type = (text: string) => {
    setTyped(text);
    const seconds = Number(text);
    if (text.trim() !== '' && Number.isFinite(seconds) && seconds >= MIN_BLOCK_LENGTH) {
      workspace.setVideoEnd(seconds);
    }
  };
  return (
    <label data-tooltip="Where the video ends, in seconds: the triangle on the timeline">
      <span>End</span>
      <div className="workspace-video-end-field">
        <input
          type="number"
          min={MIN_BLOCK_LENGTH}
          step={0.1}
          aria-label="End of the video, in seconds"
          value={typed ?? Number(videoLength(video).toFixed(2))}
          onChange={(event) => type(event.target.value)}
          onBlur={() => setTyped(undefined)}
          onKeyDown={(event) => event.key === 'Enter' && setTyped(undefined)}
        />
        <button
          className="btn-icon"
          hidden={video.end === undefined}
          data-tooltip="Back on the end of the camera"
          aria-label="Back on the end of the camera"
          onClick={() => workspace.setVideoEnd(undefined)}
        >
          {IconSet.RELOAD}
        </button>
      </div>
    </label>
  );
});

/** Saving the video as an MP4, under a name of one's own, in a folder picked after */
export const ExportSettings = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const { workspaceStore } = useStore();
  const video = workspace.video!;
  const [name, setName] = useState(workspace.name);
  // Small enough to be sent to a phone, unless asked for the full size
  const [size, setSize] = useState<VideoSize>('phone');
  const output = outputSize(video, size);
  const fileName = fileNameOf(name);
  const length = videoLength(video);
  const canSave = fileName !== '' && length > 0 && !workspaceStore.isSavingVideo;

  const save = async () => {
    if (!canSave) {
      return;
    }
    let lastFolder: string | undefined;
    try {
      lastFolder = localStorage.getItem(LAST_FOLDER_KEY) ?? undefined;
    } catch {
      // Only where the dialog opens
    }
    const { filePaths } = await RendererMessenger.showOpenDialog({
      title: `Choose a folder for "${fileName}.mp4"`,
      buttonLabel: 'Save here',
      defaultPath: lastFolder,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (filePaths.length === 0) {
      return;
    }
    try {
      localStorage.setItem(LAST_FOLDER_KEY, filePaths[0]);
    } catch {
      // Only where the dialog opens next time
    }
    workspaceStore.saveVideo(workspace, { name: fileName, folder: filePaths[0], size });
  };

  return (
    <div className="workspace-video-settings">
      <div className="workspace-video-row">
        <label>
          <span>Name</span>
          <div className="workspace-dialog-input" data-invalid={fileName === ''}>
            <input
              spellCheck={false}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <span>.mp4</span>
          </div>
        </label>
        <EndField workspace={workspace} />
        <div className="workspace-video-actions">
          <Button
            icon={IconSet.EXPORT}
            text={workspaceStore.isSavingVideo ? 'Saving…' : 'Save video…'}
            styling="filled"
            disabled={!canSave}
            onClick={save}
          />
        </div>
      </div>
      <div className="workspace-video-row">
        <label>
          <span>Size</span>
          <Choices
            options={[
              {
                value: 'phone',
                name: 'Phone',
                detail: 'Small enough to send to a phone (under 30 MB)',
              },
              { value: 'full', name: 'Full', detail: 'The size of the video, for posting' },
            ]}
            value={size}
            onChange={setSize}
          />
        </label>
        <p className="workspace-video-hint">
          {output.width} × {output.height}, {video.fps} frames a second, {formatTime(length)} long
          {video.music !== undefined ? ', with its music' : ''}. How far saving got shows at the
          bottom left.
        </p>
      </div>
    </div>
  );
});
