import fse from 'fs-extra';
import path from 'path';

import { thumbnailFormat, thumbnailMaxSize } from 'common/config';
import { IThumbnailMessage, IThumbnailMessageResponse } from '../image/ThumbnailGeneration';
import TifLoader from '../image/TifLoader';

const tifLoader = new TifLoader();

// Not part of the TypeScript lib yet
declare const ImageDecoder: any;

/** Draws an image, scaled so that either width or height becomes `thumbnailMaxSize` */
function drawThumbnail(
  img: CanvasImageSource,
  imgWidth: number,
  imgHeight: number,
): OffscreenCanvas | null {
  const scale = thumbnailMaxSize / Math.max(imgWidth, imgHeight);
  const width = Math.max(1, Math.round(imgWidth * scale));
  const height = Math.max(1, Math.round(imgHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx2D = canvas.getContext('2d');
  if (!ctx2D) {
    console.warn('No canvas context 2D (should never happen)');
    return null;
  }
  ctx2D.imageSmoothingQuality = 'high';
  ctx2D.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * JPEG files can be decoded at a fraction of their size, which is a lot faster than decoding the whole image.
 * @returns null if that is not possible for this file
 */
async function drawJpegThumbnail(buffer: Uint8Array): Promise<OffscreenCanvas | null> {
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  if (!isJpeg || typeof ImageDecoder === 'undefined') {
    return null;
  }
  let decoder: any;
  let frame: any;
  try {
    // Decoded at about twice the size of the thumbnail, so that it is still sharp when scaled down
    decoder = new ImageDecoder({
      data: buffer,
      type: 'image/jpeg',
      desiredWidth: thumbnailMaxSize * 2,
      desiredHeight: thumbnailMaxSize * 2,
    });
    frame = (await decoder.decode()).image;
    // The display size is the size after rotating the image like the camera was held
    return drawThumbnail(frame, frame.displayWidth, frame.displayHeight);
  } catch (e) {
    console.warn('Could not decode image at a reduced size, decoding it completely instead', e);
    return null;
  } finally {
    frame?.close();
    decoder?.close();
  }
}

/**
 * TIFF files cannot be decoded by the browser.
 * @returns null if it is not a TIFF file
 */
async function drawTiffThumbnail(buffer: Uint8Array): Promise<OffscreenCanvas | null> {
  const isTiff =
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a);
  if (!isTiff) {
    return null;
  }
  // The decoder needs a buffer that only contains the file: a Node buffer can be a view on a larger one
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const imageData = await tifLoader.decode(data);
  const img = await createImageBitmap(imageData);
  try {
    return drawThumbnail(img, img.width, img.height);
  } finally {
    img.close();
  }
}

async function drawFullyDecodedThumbnail(buffer: Uint8Array): Promise<OffscreenCanvas | null> {
  const img = await createImageBitmap(new Blob([buffer]));
  try {
    return drawThumbnail(img, img.width, img.height);
  } finally {
    // The decoded full-size bitmap is not freed by garbage collection in time: release it explicitly
    img.close();
  }
}

// TODO: Merge this with the generateThumbnail func from frontend/image/utils.ts, it's duplicate code
const generateThumbnailData = async (filePath: string): Promise<ArrayBuffer | null> => {
  const inputBuffer = await fse.readFile(filePath);
  const canvas =
    (await drawJpegThumbnail(inputBuffer)) ??
    (await drawTiffThumbnail(inputBuffer)) ??
    (await drawFullyDecodedThumbnail(inputBuffer));
  if (!canvas) {
    return null;
  }
  const thumbBlob = await canvas.convertToBlob({ type: `image/${thumbnailFormat}`, quality: 0.75 });
  return thumbBlob.arrayBuffer();
};

const generateAndStoreThumbnail = async (filePath: string, thumbnailFilePath: string) => {
  // Never write over the image itself: small images are their own thumbnail
  if (path.resolve(filePath).toLowerCase() === path.resolve(thumbnailFilePath).toLowerCase()) {
    return filePath;
  }

  // Could already exist: maybe generated in another worker, when use scrolls up/down repeatedly
  // but this doesn't help if we want to deliberately overwrite the thumbnail, but we don't have that currently
  if (await fse.pathExists(thumbnailFilePath)) {
    return thumbnailFilePath;
  }

  const thumbnailData = await generateThumbnailData(filePath);
  if (thumbnailData) {
    await fse.outputFile(thumbnailFilePath, Buffer.from(thumbnailData));
    return thumbnailFilePath;
  }
  return '';
};

// The worker context
const ctx: Worker = self as any;

// Set up a queue of thumbnails that need to be processed
// Without a queue, I've had to restart my computer since everything froze
// (not 100% sure whether that was the cause)
// TODO: Max queue length, so that when the user scrolls a lot, the most recent images will show up earlier?
// (-> discard old requests)
const queue: IThumbnailMessage[] = [];
const MAX_PARALLEL_THUMBNAILS = 4; // Related to amount of workers. Currently 4 workers with 4 thumbs in parallel = 16 thumbs parallel total
let curParallelThumbnails = 0;

async function processMessage(data: IThumbnailMessage) {
  const { filePath, thumbnailFilePath, fileId } = data;
  try {
    // console.log('Processing thumbnail message', { data, curParallelThumbnails, queue });
    if (curParallelThumbnails < MAX_PARALLEL_THUMBNAILS) {
      curParallelThumbnails++;
      const thumbnailPath = await generateAndStoreThumbnail(filePath, thumbnailFilePath);
      const response: IThumbnailMessageResponse = {
        fileId,
        thumbnailPath: thumbnailPath || filePath,
      };
      ctx.postMessage(response);
      curParallelThumbnails--;
    } else {
      queue.push(data);
    }
  } catch (err) {
    curParallelThumbnails--;
    console.error('Could not generate image thumbnail', data.filePath, err);
    // If an error occurs, just load the real file
    ctx.postMessage({ fileId, thumbnailPath: filePath });
  }
  if (curParallelThumbnails < MAX_PARALLEL_THUMBNAILS && queue.length > 0) {
    processMessage(queue.shift()!); // "pop" from the queue. First elements are at the start, so shift em
  }
}

// Respond to message from parent thread
ctx.addEventListener('message', async (event) => {
  await processMessage(event.data);
});
