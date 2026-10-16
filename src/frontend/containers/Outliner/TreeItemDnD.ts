import { action } from 'mobx';
import { DnDAttribute, IDnDData } from 'src/frontend/contexts/TagDnDContext';

/** How much of the top and of the bottom of an item means "above" and "below" it; the rest means "inside" */
const EDGE_SHARE = 0.3;

/**
 * A line between two items of a list: where what is being dragged would land. One element for the whole
 * page, so that it glides from place to place; the edge between two items is the same place whether
 * the pointer is at the bottom of the upper one or at the top of the lower one.
 */
let insertionLine: HTMLDivElement | undefined;
let hideTimeout: number | undefined;

function showInsertionLine(item: HTMLElement, edge: 'top' | 'bottom') {
  window.clearTimeout(hideTimeout);
  if (insertionLine === undefined) {
    insertionLine = document.createElement('div');
    insertionLine.className = 'dnd-insertion-line';
  }
  // A dialog is drawn over the rest of the page: the line for a list in one has to be inside it.
  // Otherwise inside the element that carries the theme: its colors do not exist outside of it
  const host =
    item.closest<HTMLElement>('dialog[open]') ??
    item.closest<HTMLElement>('.dark, .light') ??
    document.body;
  const isNew = insertionLine.parentElement !== host;
  if (isNew) {
    host.appendChild(insertionLine);
  }
  // Where "0, 0" is for the line is measured, not assumed: a dialog can have been moved
  const line = insertionLine;
  const previous = line.style.transform;
  line.style.transition = 'none';
  line.style.transform = 'none';
  const origin = line.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  const x = rect.left - origin.left;
  const y = (edge === 'top' ? rect.top : rect.bottom) - origin.top - 1;
  // From where it was, so that it glides. Not when it just appeared: it would fly in from the corner
  line.style.transform =
    isNew || line.dataset.shown !== 'true' ? `translate(${x}px, ${y}px)` : previous;
  line.style.width = `${rect.width}px`;
  line.getBoundingClientRect(); // the browser has to see where it starts from
  line.style.transition = '';
  line.style.transform = `translate(${x}px, ${y}px)`;
  line.dataset.shown = 'true';
}

function hideInsertionLine() {
  window.clearTimeout(hideTimeout);
  if (insertionLine !== undefined) {
    insertionLine.dataset.shown = 'false';
  }
}

/** A moment later: the pointer is usually on its way to the next item, which shows it again */
function hideInsertionLineSoon() {
  window.clearTimeout(hideTimeout);
  hideTimeout = window.setTimeout(hideInsertionLine, 80);
}

if (typeof window !== 'undefined') {
  // However a drag ends, on something that takes it or not
  window.addEventListener('dragend', hideInsertionLine, true);
  window.addEventListener('drop', hideInsertionLine, true);
}

const clearTarget = (element: HTMLElement) => {
  element.dataset[DnDAttribute.Target] = 'false';
  element.classList.remove('top', 'center', 'bottom');
};

export function createDragReorderHelper(id: string, dndType: string) {
  const previewElement = document.createElement('span');
  previewElement.id = id;
  previewElement.style.position = 'absolute';
  previewElement.style.top = '-100vh';
  document.body.appendChild(previewElement);

  return {
    previewElement,
    onDragStart: action(
      <T extends { id: string }>(
        event: React.DragEvent<HTMLDivElement>,
        text: string,
        theme: 'light' | 'dark',
        dndData: IDnDData<T>,
        nodeData: T,
      ) => {
        previewElement.classList.value = `tag ${theme}`;
        previewElement.innerText = text;
        event.dataTransfer.setData(dndType, nodeData.id);
        event.dataTransfer.setDragImage(previewElement, 0, 0);
        event.dataTransfer.effectAllowed = 'linkMove';
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.dataset[DnDAttribute.Source] = 'true';
        dndData.source = nodeData;
      },
    ),
    /**
     * Marks where the dragged item would land: above the item (class `top`), below it (`bottom`),
     * or inside it (`center`). Returns whether the event should be ignored.
     */
    onDragOver: action(
      <T extends { id: string }>(
        event: React.DragEvent<HTMLDivElement>,
        dndData: IDnDData<T>,
        isMiddleAvailable = true,
      ) => {
        const dropTarget = event.currentTarget;
        const isSource = dropTarget.dataset[DnDAttribute.Source] === 'true';
        if (
          dndData.source === undefined ||
          isSource ||
          !event.dataTransfer.types.includes(dndType)
        ) {
          return true;
        }

        event.dataTransfer.dropEffect = 'move';
        event.preventDefault();
        event.stopPropagation();
        dropTarget.dataset[DnDAttribute.Target] = 'true';
        const rect = dropTarget.getBoundingClientRect();
        // Without an inside, the upper half is above and the lower half below
        const edge = rect.height * (isMiddleAvailable ? EDGE_SHARE : 0.5);
        const place =
          event.clientY < rect.top + edge
            ? 'top'
            : event.clientY >= rect.bottom - edge
            ? 'bottom'
            : 'center';
        // Only touched when it changes: this runs many times a second while the pointer is over the item
        if (!dropTarget.classList.contains(place)) {
          dropTarget.classList.remove('top', 'center', 'bottom');
          dropTarget.classList.add(place);
        }
        if (place === 'center') {
          hideInsertionLine();
        } else {
          showInsertionLine(dropTarget, place);
        }
      },
    ),
    onDragLeave: action((event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(dndType)) {
        return true;
      }
      // On to the icon or the text of the same item: that is not leaving it.
      // Taking the mark away here made it flicker with every move of the pointer
      const to = event.relatedTarget as Node | null;
      if (to !== null && typeof to.nodeType === 'number' && event.currentTarget.contains(to)) {
        return;
      }
      event.dataTransfer.dropEffect = 'none';
      event.preventDefault();
      event.stopPropagation();
      clearTarget(event.currentTarget);
      hideInsertionLineSoon();
    }),
    onDrop: action((event: React.DragEvent<HTMLDivElement>) => {
      const targetClasses = event.currentTarget.classList;
      // Checker whether to move the dropped tag(s) into or above/below the drop target
      const relativeMovePos = targetClasses.contains('top')
        ? -1
        : targetClasses.contains('bottom')
        ? 0
        : 'middle'; // Not dragged at top or bottom, but in middle

      clearTarget(event.currentTarget);
      hideInsertionLine();

      return relativeMovePos;
    }),
  };
}
