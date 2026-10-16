import { VirtualElement, autoPlacement, offset, shift } from '@floating-ui/core';
import { useFloating } from '@floating-ui/react-dom';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const TooltipLayer = ({ document }: { document: Document }) => {
  const virtualElement = useRef<VirtualElement>({
    getBoundingClientRect: () => new DOMRect(),
    contextElement: null,
  });
  // The bar that the element with the tooltip is part of, when it is in one of the bars at the top
  const bar = useRef<Element | null>(null);
  const { x, y, reference, floating, strategy, update } = useFloating({
    middleware: [
      offset({ mainAxis: 4, crossAxis: 0 }),
      shift({ boundary: document.body, crossAxis: true, padding: 8 }),
      autoPlacement(),
      // For a button of a bar: always underneath the whole bar, so its other buttons stay readable
      {
        name: 'belowBar',
        fn: ({ rects }) => {
          if (bar.current === null) {
            return {};
          }
          const barRect = bar.current.getBoundingClientRect();
          const { reference: button, floating: tooltip } = rects;
          const centered = button.x + button.width / 2 - tooltip.width / 2;
          const maxX = document.documentElement.clientWidth - tooltip.width - 8;
          return { x: Math.max(8, Math.min(centered, maxX)), y: barRect.bottom + 4 };
        },
      },
    ],
  });
  const [isOpen, setIsOpen] = useState(false);
  const tooltipElement = useRef<HTMLDivElement | null>(null);
  /** Where the tooltip is in the page while it is not inside a dialog */
  const home = useRef<HTMLElement | null>(null);
  const content = useRef<string>('');
  const timerID = useRef<number>();

  // Counts up when the text changes while the tooltip is open, so it is drawn again
  const [textVersion, setTextVersion] = useState(0);

  // Placed again once its text is in: it is measured to keep it inside the window
  useLayoutEffect(() => {
    if (isOpen) {
      update();
    }
  }, [isOpen, textVersion, update]);

  useEffect(() => {
    reference(virtualElement.current);

    // The text of a tooltip can change while it is shown: a button that was just clicked says something else
    const observer = new MutationObserver(() => {
      const text = (virtualElement.current.contextElement as HTMLElement | null)?.dataset[
        'tooltip'
      ];
      if (!text) {
        setIsOpen(false);
      } else if (text !== content.current) {
        content.current = text;
        setTextVersion((version) => version + 1);
      }
    });

    const handleShow = (e: MouseEvent | FocusEvent): HTMLElement | undefined => {
      // The pointer is usually over something inside the element with the tooltip: the icon of a button
      const origin = e.target as { closest?: (selector: string) => HTMLElement | null } | null;
      const target =
        typeof origin?.closest === 'function' ? origin.closest('[data-tooltip]') : null;
      if (target === null || !target.dataset['tooltip']) {
        return;
      }
      content.current = target.dataset['tooltip'];
      // An open dialog is drawn over everything else on the page, whatever its z-index:
      // a tooltip for something in it has to be inside it to be seen
      const tooltip = tooltipElement.current;
      if (tooltip !== null) {
        home.current ??= tooltip.parentElement;
        const host = target.closest<HTMLElement>('dialog[open]') ?? home.current;
        if (host !== null && tooltip.parentElement !== host) {
          host.appendChild(tooltip);
        }
      }
      if (virtualElement.current.contextElement !== target) {
        window.clearTimeout(timerID.current);
        timerID.current = window.setTimeout(() => {
          timerID.current = undefined;
          setIsOpen(true);
          update();
        }, 500);
      }
      bar.current = (target as Element).closest?.('#toolbar, #top-bar') ?? null;
      const boundingRect = target.getBoundingClientRect();
      virtualElement.current.getBoundingClientRect = () => boundingRect;
      virtualElement.current.contextElement = target;
      // Only the element the tooltip belongs to is watched
      observer.disconnect();
      observer.observe(target, { attributes: true, attributeFilter: ['data-tooltip'] });
    };

    const handleHide = (e: MouseEvent | FocusEvent) => {
      if (virtualElement.current.contextElement?.contains(e.relatedTarget as Node)) {
        return;
      }
      setIsOpen(false);
      virtualElement.current.contextElement = null;
      observer.disconnect();
      window.clearTimeout(timerID.current);
      timerID.current = undefined;
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        virtualElement.current.contextElement = null;
      }
    };

    // A tooltip that stays behind while its element is dragged away is in the way
    const handleDragStart = () => {
      setIsOpen(false);
      virtualElement.current.contextElement = null;
      observer.disconnect();
      window.clearTimeout(timerID.current);
      timerID.current = undefined;
    };

    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('mouseover', handleShow, true);
    document.addEventListener('mouseout', handleHide, true);
    document.addEventListener('focus', handleShow, true);
    document.addEventListener('blur', handleHide, true);
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('dragstart', handleDragStart, true);
      document.removeEventListener('mouseover', handleShow, true);
      document.removeEventListener('mouseout', handleHide, true);
      document.removeEventListener('focus', handleShow, true);
      document.removeEventListener('blur', handleHide, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [document, update, reference]);

  return (
    <div
      ref={(element) => {
        tooltipElement.current = element;
        floating(element);
      }}
      style={{
        position: strategy,
        top: 0,
        left: 0,
        transform: `translate(${Math.round(x ?? 0.0)}px,${Math.round(y ?? 0.0)}px)`,
      }}
      role="tooltip"
      data-popover
      data-open={isOpen}
    >
      {content.current}
    </div>
  );
};
