import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';

import { IconSet } from 'widgets';
import { AppToaster, Toast } from '../components/Toaster';
import { useStore } from '../contexts/StoreContext';

/** How long a message takes to fade away once it is done; the same as in status-footer.scss */
const LEAVE_DURATION = 250;

/**
 * The one place for what the app tells the user, at the foot of the side panel (or, with the side panel
 * hidden, at the bottom left of the window): messages (`AppToaster`), each with what can be done about
 * it, and under them how far the work in the background got: the sources being looked through at
 * start-up, or the images of a workspace being prepared. Nothing pops up anywhere else.
 */
const StatusFooter = observer(() => {
  const { uiStore, locationStore, workspaceStore } = useStore();
  return (
    <div
      id="status-footer"
      data-docked={uiStore.isOutlinerOpen}
      data-busy={locationStore.scanProgress !== undefined || workspaceStore.preparing !== undefined}
      style={uiStore.isOutlinerOpen ? { width: uiStore.outlinerWidth } : undefined}
    >
      <Messages />
      <BackgroundProgress />
    </div>
  );
});

/**
 * The messages, newest last. One that is done stays a moment to fade away. A message without a time
 * (`timeout: 0`) is work going on, and shows the running line of the progress bar.
 */
const Messages = observer(() => {
  const current = AppToaster.toastList.slice();
  const [leaving, setLeaving] = useState<Toast[]>([]);
  const previous = useRef<Toast[]>(current);

  useEffect(() => {
    const ids = new Set(current.map((toast) => toast.id));
    const gone = previous.current.filter((toast) => !ids.has(toast.id));
    previous.current = current;
    if (gone.length > 0) {
      setLeaving((list) => [...list, ...gone]);
      // Not cleared when it draws again meanwhile: then a message that left would stay. The footer is
      // always there, so the timer always finds it
      setTimeout(
        () => setLeaving((list) => list.filter((toast) => !gone.includes(toast))),
        LEAVE_DURATION,
      );
    }
  });

  // A message shown again (the same id) while it was still fading away is not shown twice
  const currentIds = new Set(current.map((toast) => toast.id));
  const shown = [
    ...leaving
      .filter((toast) => !currentIds.has(toast.id))
      .map((toast) => ({ toast, isLeaving: true })),
    ...current.map((toast) => ({ toast, isLeaving: false })),
  ];
  return (
    <div className="status-messages" role="status" aria-live="polite">
      {shown.map(({ toast, isLeaving }) => (
        <div
          key={isLeaving ? `${toast.id}:leaving` : toast.id}
          className="status-message"
          data-leaving={isLeaving}
          data-working={toast.timeout === 0}
        >
          <div className="status-message-row">
            <span className="status-message-text">{toast.message}</span>
            <button
              className="status-message-close btn-icon"
              aria-label="Dismiss"
              onClick={() => AppToaster.dismiss(toast.id)}
            >
              {IconSet.CLOSE}
            </button>
          </div>
          {toast.clickAction !== undefined && (
            <button
              className="status-message-action"
              onClick={() => {
                toast.clickAction?.onClick();
                AppToaster.dismiss(toast.id);
              }}
            >
              {toast.clickAction.label}
            </button>
          )}
          {toast.timeout === 0 && <div className="track" />}
        </div>
      ))}
    </div>
  );
});

/**
 * A bar while something is going on in the background: the sources being checked for new and changed
 * images at start-up, or the images of a workspace being prepared. It glides in and out of sight; the
 * last words stay while it fades away.
 */
const BackgroundProgress = observer(() => {
  const { locationStore, workspaceStore } = useStore();
  const scan = locationStore.scanProgress;
  const preparing = workspaceStore.preparing?.progress;
  const preparingName = workspaceStore.preparing?.workspace.name;

  const current =
    scan !== undefined
      ? {
          label: 'Looking for new images',
          detail: `${scan.done} of ${scan.total} sources`,
          // Halfway into the source that is being looked at
          fraction: (scan.done + 0.5) / scan.total,
        }
      : preparing !== undefined
      ? {
          label: `Preparing ${preparingName}`,
          detail: `${preparing.done.toLocaleString()} of ${preparing.total.toLocaleString()} images`,
          fraction: preparing.total > 0 ? preparing.done / preparing.total : 0,
        }
      : undefined;
  const last = useRef(current);
  if (current !== undefined) {
    last.current = current;
  }
  const shown = current ?? last.current;

  return (
    <div
      className="background-progress"
      role="progressbar"
      aria-label={shown?.label}
      aria-hidden={current === undefined}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={current?.fraction ?? 1}
      data-active={current !== undefined}
    >
      <div className="background-progress-text">
        <span className="label">{shown?.label}</span>
        <span className="detail">{shown?.detail}</span>
      </div>
      <div className="track">
        {/* All the way when done, while it fades out */}
        <div className="fill" style={{ transform: `scaleX(${current?.fraction ?? 1})` }} />
      </div>
    </div>
  );
});

export default StatusFooter;
