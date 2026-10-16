import { shell } from 'electron';
import path from 'path';

import { fileNameOf, writeNewFile } from 'common/export';
import { encodeFilePath } from 'common/fs';
import { SHARP_DECODABLE } from 'common/sharp-size';
import {
  boundsOf,
  overlaps,
  Rect,
  TEXT_LINE_HEIGHT,
  textInk,
  WorkspaceItem,
} from 'common/workspace';
import { AppToaster } from '../../components/Toaster';
import { ClientWorkspace } from '../../entities/Workspace';
import { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { TEXT_FONT_WEIGHT } from './measureText';

/**
 * The longest side of the picture: some 700 dots per inch on A4. More would only make it slow (a picture
 * of 127 megapixels took over half a minute to make)
 */
const MAX_SIDE = 8192;
const MAX_PIXELS = 50_000_000;

/**
 * What the picture shows: the background that is selected, or else what is selected, or else everything
 * on the workspace
 */
function pictureArea(workspace: ClientWorkspace): Rect | undefined {
  const background = workspace.selectedBackground;
  if (background !== undefined) {
    return background;
  }
  const selected = workspace.items.filter((item) => workspace.selection.has(item.id));
  return boundsOf(selected.length > 0 ? selected : workspace.items);
}

/**
 * How many pixels to give one unit of the workspace: as many as the sharpest image in the area has, so
 * that none of them is shown with fewer pixels than its file has; within what a picture can hold
 */
function pictureScale(
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
async function renderPicture(
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
  const scale = pictureScale(area, inArea, sources);
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
      const ink = textInk(item, inArea, (color) => colorOf(color, ''));
      context.fillStyle = colorOf(
        ink ?? '',
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
        console.error('Could not draw an image into the picture', source.file.absolutePath, e);
      }
    }
  }
  return canvas;
}

/** The ways a workspace can be saved as a picture, and the extensions of their files */
export type PictureFormat = 'png' | 'jpeg';
export const PICTURE_EXTENSIONS: Record<PictureFormat, string> = { png: 'png', jpeg: 'jpg' };

/** What the picture of a workspace will show, in words, for the dialog that saves it */
export function pictureAreaName(workspace: ClientWorkspace): string {
  return workspace.selectedBackground !== undefined
    ? 'The selected sheet'
    : workspace.selection.size > 0
    ? 'What is selected'
    : 'Everything on the workspace';
}

/**
 * Saves the picture of the workspace (`pictureArea`) at the full resolution of its images, as `name` in
 * `folder`, never over another file: a name that is taken gets a number (`writeNewFile`). Making it
 * takes a moment with many large images: a message says so meanwhile, and where it went afterwards.
 */
export async function saveWorkspacePicture(
  workspace: ClientWorkspace,
  sources: ReadonlyMap<string, WorkspaceImageSource>,
  themeOf: HTMLElement,
  options: { name: string; format: PictureFormat; folder: string },
): Promise<void> {
  const area = pictureArea(workspace);
  if (area === undefined) {
    return;
  }
  AppToaster.show(
    { message: 'Making the picture, at full resolution…', timeout: 0 },
    'workspace-picture',
  );
  try {
    const canvas = await renderPicture(workspace, sources, area, themeOf);
    const blob = await new Promise<Blob | null>((resolve) =>
      // A JPEG this good shows no loss in a photo, at a fraction of the size of a PNG
      canvas.toBlob(resolve, `image/${options.format}`, 0.95),
    );
    if (blob === null) {
      throw new Error('The picture could not be encoded');
    }
    const fileName = `${fileNameOf(options.name) || 'Workspace'}.${
      PICTURE_EXTENSIONS[options.format]
    }`;
    const saved = await writeNewFile(
      options.folder,
      fileName,
      new Uint8Array(await blob.arrayBuffer()),
    );
    AppToaster.show(
      {
        message: `Saved as ${path.basename(saved)}`,
        timeout: 8000,
        clickAction: { label: 'Show', onClick: () => shell.showItemInFolder(saved) },
      },
      'workspace-picture',
    );
  } catch (e) {
    console.error('Could not save the workspace as a picture', e);
    AppToaster.show(
      { message: 'The picture could not be saved.', timeout: 6000 },
      'workspace-picture',
    );
  }
}
