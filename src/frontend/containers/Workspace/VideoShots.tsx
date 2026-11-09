import { observer } from 'mobx-react-lite';
import React, { useLayoutEffect } from 'react';

import { shotBefore } from 'common/video';
import { ClientWorkspace } from '../../entities/Workspace';
import { VIDEO_FRAME_ID } from './WorkspaceSurface';

/**
 * The shots of the video's camera stops, where they are on the workspace: dotted, each with a label
 * ("Shot 1"), the one before the selected one fuller; the selected one in the accent colour with the rest
 * of the view blurred and darkened (`workspace-shot-veil`), and, while it is edited (`isEditingShot`),
 * with a handle at its corner to size it. Only that one takes the pointer (the surface moves or sizes
 * it); presses go through the others to the workspace. Without camera stops, the frame of the video. The
 * surface places them in every frame, and cuts the selected one out of the veil and the others
 * (`placeShots`).
 */
const VideoShots = observer(
  ({ workspace, place }: { workspace: ClientWorkspace; place: () => void }) => {
    const { video, selectedBlock, isEditingShot } = workspace;
    // Drawn anew: placed at once, before they are painted where they were not
    useLayoutEffect(place);
    if (video === undefined) {
      return null;
    }
    // Every element with a key of its own: the surface sets the place of each in the page, and an element
    // React took over for another (the frame of the video for the veil) kept that place
    if (video.camera.length === 0) {
      return (
        <div key={VIDEO_FRAME_ID} className="workspace-shot" data-shot-id={VIDEO_FRAME_ID}>
          <span className="workspace-shot-label">
            Video{' '}
            <small>
              {video.width} × {video.height}
            </small>
          </span>
        </div>
      );
    }
    const selectedId = selectedBlock?.lane === 'camera' ? selectedBlock.id : undefined;
    const previous = shotBefore(video, selectedId);
    return (
      <>
        {/* Around the selected shot everything blurred and darkened; the surface cuts its hole */}
        {selectedId !== undefined && <div key="veil" className="workspace-shot-veil" />}
        {video.camera.map((stop, i) => {
          const isSelected = stop.id === selectedId;
          const isEditing = isSelected && isEditingShot;
          return (
            <div
              key={stop.id}
              className="workspace-shot"
              data-shot-id={stop.id}
              data-selected={isSelected}
              data-previous={stop === previous}
              data-editing={isEditing}
            >
              <span className="workspace-shot-label">
                Shot {i + 1}
                {isEditing && <small>drag to move · corner to size · Enter when done</small>}
              </span>
              {isEditing && <span className="workspace-shot-handle" />}
            </div>
          );
        })}
      </>
    );
  },
);

export default VideoShots;
