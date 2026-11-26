import { shell } from 'electron';
import path from 'path';

import { borderInsets, cropOf, photoRectOf } from 'common/crop';
import { fileNameOf, writeNewFile } from 'common/export';
import { encodeFilePath } from 'common/fs';
import { SHARP_DECODABLE } from 'common/sharp-size';
import { boundsOf, overlaps, Rect, textInk, WorkspaceItem } from 'common/workspace';
import { AppToaster } from '../../components/Toaster';
import { ClientWorkspace } from '../../entities/Workspace';
import { WorkspaceImageSource } from '../../stores/WorkspaceStore';
import { WorkspacePainter } from './paintWorkspace';

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
  const visible = workspace.items.filter((item) => !item.isHidden);
  const selected = visible.filter((item) => workspace.selection.has(item.id));
  return boundsOf(selected.length > 0 ? selected : visible);
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
    if (item.kind === 'image' && source !== undefined && source.file.width > 0) {
      // As many pixels as the whole photo has over the size it lies at, cropped or not
      const photo = photoRectOf(item);
      scale = Math.max(
        scale,
        Math.min(source.file.width / photo.width, source.file.height / photo.height),
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
export async function loadImage(source: WorkspaceImageSource): Promise<HTMLImageElement> {
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
    .filter((item) => !item.isHidden && overlaps(item, area))
    .sort(
      (a, b) =>
        (a.kind === 'background' ? -1 : 0) - (b.kind === 'background' ? -1 : 0) || a.z - b.z,
    );
  const scale = pictureScale(area, inArea, sources);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const paint = new WorkspacePainter(canvas.getContext('2d')!, themeOf);

  for (const item of inArea) {
    const at = {
      x: (item.x - area.x) * scale,
      y: (item.y - area.y) * scale,
      width: item.width * scale,
      height: item.height * scale,
    };
    if (item.kind === 'background') {
      paint.background(item, at);
    } else if (item.kind === 'text') {
      paint.text(
        item,
        at,
        textInk(item, inArea, (color) => paint.colorOf(color, '')),
      );
    } else {
      const source = sources.get(item.fileId);
      if (source === undefined) {
        continue;
      }
      try {
        const image = await loadImage(source);
        // The part of the photo it shows, as on screen
        if (item.border !== undefined) {
          paint.fill(item.border.color, at);
          const { topBottom, sides } = borderInsets(item);
          paint.image(image, cropOf(item), {
            x: at.x + sides * scale,
            y: at.y + topBottom * scale,
            width: Math.max(1, at.width - 2 * sides * scale),
            height: Math.max(1, at.height - 2 * topBottom * scale),
          });
        } else {
          paint.image(image, cropOf(item), at);
        }
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
