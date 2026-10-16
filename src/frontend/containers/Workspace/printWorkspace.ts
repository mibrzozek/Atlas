import { encodeFilePath } from 'common/fs';
import { SHARP_DECODABLE } from 'common/sharp-size';
import { boundsOf, overlaps, Rect, TEXT_LINE_HEIGHT, WorkspaceItem } from 'common/workspace';
import { AppToaster } from '../../components/Toaster';
import { ClientWorkspace } from '../../entities/Workspace';
import { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { TEXT_FONT_WEIGHT } from './measureText';

/**
 * The longest side of the picture: some 700 dots per inch on A4, more than a printer prints. More would
 * only make it slow (a picture of 127 megapixels took over half a minute and never reached the dialog)
 */
const MAX_SIDE = 8192;
const MAX_PIXELS = 50_000_000;

/**
 * What is printed: the background that is selected, or else what is selected, or else everything on the
 * workspace
 */
export function printArea(workspace: ClientWorkspace): Rect | undefined {
  const background = workspace.selectedBackground;
  if (background !== undefined) {
    return background;
  }
  const selected = workspace.items.filter((item) => workspace.selection.has(item.id));
  return boundsOf(selected.length > 0 ? selected : workspace.items);
}

/**
 * How many pixels to give one unit of the workspace: as many as the sharpest image in the area has, so
 * that none of them is printed with fewer pixels than its file has; within what a picture can hold
 */
function printScale(
  area: Rect,
  items: readonly WorkspaceItem[],
  sources: ReadonlyMap<string, WorkspaceImageSource>,
) {
  let scale = 1;
  for (const item of items) {
    const source = item.kind === 'image' ? sources.get(item.fileId) : undefined;
    if (source !== undefined && source.file.width > 0) {
      // Cut to its frame, the image covers it: the side that fills it sets how many pixels there are
      scale = Math.max(
        scale,
        Math.min(source.file.width / item.width, source.file.height / item.height),
      );
    }
  }
  return Math.min(
    scale,
    MAX_SIDE / area.width,
    MAX_SIDE / area.height,
    Math.sqrt(MAX_PIXELS / (area.width * area.height)),
  );
}

/** The image of a file, decoded as it is shown (turned by its Exif orientation, as an <img> is) */
async function loadImage(source: WorkspaceImageSource): Promise<HTMLImageElement> {
  const image = new Image();
  // The file itself where the browser can read it; the thumbnail for other formats (TIFF, PSD...)
  image.src = SHARP_DECODABLE.has(source.file.extension)
    ? encodeFilePath(source.file.absolutePath)
    : source.src;
  await image.decode();
  return image;
}

/**
 * The area of the workspace drawn into one picture at the full resolution of its images: backgrounds,
 * then everything else from back to front, each image cut to its frame as on screen
 */
export async function renderForPrint(
  workspace: ClientWorkspace,
  sources: ReadonlyMap<string, WorkspaceImageSource>,
  area: Rect,
  themeOf: HTMLElement,
): Promise<HTMLCanvasElement> {
  const inArea = workspace.items
    .filter((item) => overlaps(item, area))
    .sort(
      (a, b) =>
        (a.kind === 'background' ? -1 : 0) - (b.kind === 'background' ? -1 : 0) || a.z - b.z,
    );
  const scale = printScale(area, inArea, sources);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  // Colours of the theme are written as var(--...): they are looked up where the workspace is drawn
  const style = getComputedStyle(themeOf);
  const colorOf = (color: string, fallback: string) => {
    const name = /^var\((--[\w-]+)\)$/.exec(color)?.[1];
    return (name !== undefined ? style.getPropertyValue(name).trim() : color) || fallback;
  };
  const fontFamily = getComputedStyle(document.body).fontFamily;

  for (const item of inArea) {
    const x = (item.x - area.x) * scale;
    const y = (item.y - area.y) * scale;
    const width = item.width * scale;
    const height = item.height * scale;
    if (item.kind === 'background') {
      context.fillStyle = colorOf(item.color, '#ffffff');
      context.fillRect(x, y, width, height);
    } else if (item.kind === 'text') {
      const fontSize = item.fontSize * scale;
      context.fillStyle = colorOf(
        item.color,
        style.getPropertyValue('--text-color').trim() || '#000',
      );
      context.font = `${TEXT_FONT_WEIGHT} ${fontSize}px ${fontFamily}`;
      context.textBaseline = 'middle';
      item.text.split('\n').forEach((line, i) => {
        context.fillText(line, x, y + (i + 0.5) * fontSize * TEXT_LINE_HEIGHT);
      });
    } else {
      const source = sources.get(item.fileId);
      if (source === undefined) {
        continue;
      }
      try {
        const image = await loadImage(source);
        // Cut to the frame from the middle, as `object-fit: cover` does on screen
        const frame = width / height;
        const natural = image.naturalWidth / image.naturalHeight;
        const sw = natural > frame ? image.naturalHeight * frame : image.naturalWidth;
        const sh = natural > frame ? image.naturalHeight : image.naturalWidth / frame;
        context.drawImage(
          image,
          (image.naturalWidth - sw) / 2,
          (image.naturalHeight - sh) / 2,
          sw,
          sh,
          x,
          y,
          width,
          height,
        );
        image.src = ''; // let go of the decoded pixels
      } catch (e) {
        console.error('Could not draw an image for printing', source.file.absolutePath, e);
      }
    }
  }
  return canvas;
}

/** The picture in the system's print dialog, as large as fits on the page; not encoded on the way */
export async function printPicture(canvas: HTMLCanvasElement): Promise<void> {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position: fixed; width: 0; height: 0; border: 0; visibility: hidden';
  document.body.appendChild(frame);
  try {
    const page = frame.contentDocument!;
    page.open();
    page.write(`<!doctype html><style>
      @page { margin: 0 }
      html, body { margin: 0; height: 100% }
      canvas { display: block; width: 100%; height: 100vh; object-fit: contain }
    </style>`);
    page.close();
    page.body.appendChild(page.adoptNode(canvas));
    // Taken away once the printing is done, not at once: a job that is still being sent would come out blank
    frame.contentWindow!.addEventListener('afterprint', () => frame.remove());
    frame.contentWindow!.print();
  } catch (e) {
    frame.remove();
    throw e;
  }
}

/**
 * Prints the workspace (see `printArea`) at the full resolution of its images. Making the picture takes a
 * moment with many large images: a message says so meanwhile.
 */
export async function printWorkspace(
  workspace: ClientWorkspace,
  sources: ReadonlyMap<string, WorkspaceImageSource>,
  themeOf: HTMLElement,
): Promise<void> {
  const area = printArea(workspace);
  if (area === undefined) {
    return;
  }
  AppToaster.show(
    { message: 'Making the picture to print, at full resolution…', timeout: 0 },
    'print',
  );
  try {
    const canvas = await renderForPrint(workspace, sources, area, themeOf);
    AppToaster.dismiss('print');
    await printPicture(canvas);
  } catch (e) {
    console.error('Could not print the workspace', e);
    AppToaster.show({ message: 'The workspace could not be printed.', timeout: 6000 }, 'print');
  }
}
