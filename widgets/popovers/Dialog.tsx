import React, { useEffect, useId, useRef } from 'react';
import { IconSet } from 'widgets/icons';

import 'widgets/utility/utility.scss';

export interface DialogProps {
  open: boolean;
  title: string;
  icon: JSX.Element;
  describedby?: string;
  children: React.ReactNode;
  /** Whether the dialog can be dragged around by its header */
  isMovable?: boolean;
  onCancel: () => void;
  onClose?: () => void;
}

export const Dialog = (props: DialogProps) => {
  const { open, title, icon, describedby, isMovable, onClose, onCancel, children } = props;

  const dialog = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }

    if (onClose) {
      element.addEventListener('close', onClose);
    }
    element.addEventListener('cancel', onCancel);

    return () => {
      if (onClose) {
        element.removeEventListener('close', onClose);
      }
      element.removeEventListener('cancel', onCancel);
    };
  }, [onClose, onCancel]);

  // How far the dialog has been dragged away from where it opens
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (dialog.current) {
      if (open) {
        // Always opens in its normal place
        offset.current = { x: 0, y: 0 };
        dialog.current.style.translate = '';
      }
      open ? dialog.current.showModal() : dialog.current.close();
    }
  }, [open]);

  const handleHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = dialog.current;
    const header = event.currentTarget;
    if (
      !isMovable ||
      element === null ||
      event.button !== 0 ||
      (event.target as Element).closest('button') !== null
    ) {
      return;
    }
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    // Where the dialog sits without any offset, and where in the dialog it was grabbed
    const homeLeft = rect.left - offset.current.x;
    const homeTop = rect.top - offset.current.y;
    const grabX = event.clientX - offset.current.x;
    const grabY = event.clientY - offset.current.y;
    // The window title bar belongs to the system: a header underneath it could not be grabbed again
    const titlebarHeight =
      parseFloat(getComputedStyle(element).getPropertyValue('--window-titlebar-height')) || 0;
    const REACHABLE = 160;

    const handleMove = (e: PointerEvent) => {
      // Keep enough of the header inside the window to drag it back
      const x = Math.min(
        Math.max(e.clientX - grabX, REACHABLE - rect.width - homeLeft),
        window.innerWidth - REACHABLE - homeLeft,
      );
      const y = Math.min(
        Math.max(e.clientY - grabY, titlebarHeight - homeTop),
        window.innerHeight - header.offsetHeight - homeTop,
      );
      offset.current = { x, y };
      element.style.translate = `${x}px ${y}px`;
    };
    const handleEnd = () => {
      header.removeEventListener('pointermove', handleMove);
      header.removeEventListener('pointerup', handleEnd);
      header.removeEventListener('pointercancel', handleEnd);
    };
    header.setPointerCapture(event.pointerId);
    header.addEventListener('pointermove', handleMove);
    header.addEventListener('pointerup', handleEnd);
    header.addEventListener('pointercancel', handleEnd);
  };

  return (
    <dialog ref={dialog} aria-labelledby={dialogTitleId} aria-describedby={describedby}>
      <div
        className="dialog-header"
        data-movable={isMovable || undefined}
        onPointerDown={handleHeaderPointerDown}
      >
        <span className="dialog-icon">{icon}</span>
        <span id={dialogTitleId} className="dialog-title">
          {title}
        </span>
        <button aria-keyshortcuts="Esc" className="btn-icon dialog-close" onClick={onCancel}>
          {IconSet.CLOSE}
          <span className="visually-hidden">Close</span>
        </button>
      </div>
      {children}
    </dialog>
  );
};
