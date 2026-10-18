import { observer } from 'mobx-react-lite';
import React from 'react';

import { CROP_HANDLES, CROP_PRESETS } from 'common/crop';
import { ClientWorkspace } from '../../entities/Workspace';
import { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { useSharpSource } from './WorkspaceObject';

/**
 * An image being cropped (`ClientWorkspace.cropping`), over everything else on the workspace, which is
 * blurred under it: its whole photo, the frame of what it will show (dark around it), with handles to
 * size it and the thirds to line things up with, and the tools of cropping next to it. A drag on the photo
 * moves it under the frame, Alt + wheel zooms it (`WorkspaceSurface`).
 */
const CropOverlay = observer(
  ({
    workspace,
    source,
    zoom,
  }: {
    workspace: ClientWorkspace;
    source: WorkspaceImageSource | undefined;
    zoom: number;
  }) => {
    const { cropping } = workspace;
    const sharpSrc = useSharpSource(
      source,
      (cropping?.photo.width ?? 0) * zoom,
      (cropping?.photo.height ?? 0) * zoom,
    );
    if (cropping === undefined || source === undefined) {
      return null;
    }
    const { photo, frame } = cropping;
    // The handles and lines are as large on the screen at every zoom: sized by `--zoom`, which the
    // surface sets in every frame of the camera (workspace.scss)
    return (
      <div className="workspace-crop">
        <img
          className="workspace-crop-photo"
          src={sharpSrc ?? source.src}
          alt={source.name}
          draggable={false}
          style={{ left: photo.x, top: photo.y, width: photo.width, height: photo.height }}
        />
        <div
          className="workspace-crop-frame"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
          }}
        >
          <div className="workspace-crop-thirds" />
          {CROP_HANDLES.map((name) => (
            <div key={name} className="workspace-crop-handle" data-crop-handle={name} />
          ))}
        </div>
      </div>
    );
  },
);

/**
 * The tools of cropping: shapes, reset, cancel and done. In pixels of the screen, always one size: the
 * surface places them under the frame in every frame of the camera, within the view (`placeCropTools`)
 */
export const CropTools = observer(({ workspace }: { workspace: ClientWorkspace }) => {
  const { cropping } = workspace;
  if (cropping === undefined) {
    return null;
  }
  const { photo, aspect } = cropping;
  const photoAspect = photo.width / photo.height;
  const isChosen = (preset: number | 'photo' | undefined) =>
    preset === undefined
      ? aspect === undefined
      : aspect !== undefined &&
        Math.abs(aspect - (preset === 'photo' ? photoAspect : preset)) < 0.001;
  return (
    <div className="workspace-crop-tools">
      <div className="workspace-crop-shapes" role="group" aria-label="Shape">
        {CROP_PRESETS.map((preset) => (
          <button
            key={preset.name}
            aria-pressed={isChosen(preset.aspect)}
            onClick={() => workspace.setCropShape(preset.aspect)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="workspace-crop-actions">
        <button onClick={workspace.resetCrop}>Reset</button>
        <button onClick={workspace.cancelCrop}>Cancel</button>
        <button className="workspace-crop-done" onClick={workspace.applyCrop}>
          Done
        </button>
      </div>
    </div>
  );
});

export default CropOverlay;
