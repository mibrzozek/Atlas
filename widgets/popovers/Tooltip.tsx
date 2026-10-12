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

    const handleShow = (e: MouseEvent | FocusEvent): HTMLElement | undefined => {
      const target = e.target as any;
      if (target === null || !('dataset' in target) || !(target.dataset as any)['tooltip']) {
        return;
      }
      content.current = target.dataset['tooltip'];
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
    };

    const handleHide = (e: MouseEvent | FocusEvent) => {
      if (virtualElement.current.contextElement?.contains(e.relatedTarget as Node)) {
        return;
      }
      setIsOpen(false);
      virtualElement.current.contextElement = null;
      window.clearTimeout(timerID.current);
      timerID.current = undefined;
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        virtualElement.current.contextElement = null;
      }
    };

    // The text of a tooltip can change while it is shown: a button that was just clicked says something else
    const observer = new MutationObserver((mutations) => {
      const target = virtualElement.current.contextElement as HTMLElement | null;
      if (target === null || !mutations.some((mutation) => mutation.target === target)) {
        return;
      }
      const text = target.dataset['tooltip'];
      if (!text) {
        setIsOpen(false);
      } else if (text !== content.current) {
        content.current = text;
        setTextVersion((version) => version + 1);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tooltip'],
    });

    document.addEventListener('mouseover', handleShow, true);
    document.addEventListener('mouseout', handleHide, true);
    document.addEventListener('focus', handleShow, true);
    document.addEventListener('blur', handleHide, true);
    document.addEventListener('keydown', handleEscape, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('mouseover', handleShow, true);
      document.removeEventListener('mouseout', handleHide, true);
      document.removeEventListener('focus', handleShow, true);
      document.removeEventListener('blur', handleHide, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [document, update, reference]);

  return (
    <div
      ref={floating}
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
