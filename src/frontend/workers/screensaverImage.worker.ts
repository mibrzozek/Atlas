import fse from 'fs-extra';

/**
 * Draws images at exactly the size, in device pixels, they are shown at, for the screensaver and for
 * large images in the gallery: an image that
 * the screen has to scale is never as sharp as one that was scaled down from the photo with a good filter.
 * Reads the image files, never writes anything.
 *
 * Decoding a photo takes long, and the same image is needed again at a slightly different size every time
 * the wall moves. So a decoded copy that is a little larger than needed is kept per image (its "master"),
 * and the exact sizes are drawn from that.
 */

export interface ScreensaverImageRequest {
  type: 'draw';
  requestId: number;
  id: string;
  /** The file to decode, and one to use when that fails */
  src: string;
  fallbackSrc?: string;
  /** The size to draw it at, in device pixels */
  width: number;
  height: number;
  /**
   * Hand it back as an encoded image of this type instead of a bitmap: for showing it in an `<img>`,
   * like the gallery does
   */
  encodeAs?: 'image/jpeg' | 'image/webp';
  /** Do not keep its decoded copy for a next request: the gallery asks for an image once */
  once?: boolean;
}

export interface ScreensaverImageForget {
  type: 'forget';
  id: string;
}

/** The request is no longer needed: skip it when it has not been started yet */
export interface ScreensaverImageCancel {
  type: 'cancel';
  requestId: number;
}

export interface ScreensaverImageResponse {
  requestId: number;
  bitmap?: ImageBitmap;
  blob?: Blob;
  error?: string;
  isCancelled?: boolean;
}

// Not part of the TypeScript lib yet
declare const ImageDecoder: any;

interface Master {
  bitmap: ImageBitmap;
  /** Whether this is all the detail the file has: decoding it again cannot make it larger */
  isFullSize: boolean;
}

/** Masters are this much larger than what was asked for, so that a slightly larger size can be drawn too */
const MASTER_HEADROOM = 1.3;
/** Kept for the images that are on screen or about to be. The least recently used go first */
const MAX_MASTERS = 24;

// In order of use: a Map remembers the order in which keys were added
const masters = new Map<string, Master>();

function touch(id: string, master: Master) {
  masters.delete(id);
  masters.set(id, master);
  for (const [oldId, old] of masters) {
    if (masters.size <= MAX_MASTERS) {
      break;
    }
    old.bitmap.close();
    masters.delete(oldId);
  }
}

function forget(id: string) {
  masters.get(id)?.bitmap.close();
  masters.delete(id);
}

/**
 * JPEG files can be decoded at a fraction of their size, which is much faster and takes far less memory
 * than decoding all 20 megapixels of a photo.
 */
async function decodeJpeg(
  buffer: Uint8Array,
  width: number,
  height: number,
): Promise<Master | undefined> {
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  if (!isJpeg || typeof ImageDecoder === 'undefined') {
    return undefined;
  }
  const decode = async (desired?: { desiredWidth: number; desiredHeight: number }) => {
    let decoder: any;
    let frame: any;
    try {
      decoder = new ImageDecoder({ data: buffer, type: 'image/jpeg', ...desired });
      frame = (await decoder.decode()).image;
      // Drawn through a canvas: that applies the rotation the camera stored, like the display size says
      const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
      canvas.getContext('2d')!.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
      return canvas.transferToImageBitmap();
    } finally {
      frame?.close();
      decoder?.close();
    }
  };
  try {
    // The size is only a hint, and it is about the image as stored: ask for the longest side both ways
    const side = Math.ceil(Math.max(width, height) * MASTER_HEADROOM);
    const reduced = await decode({ desiredWidth: side, desiredHeight: side });
    if (reduced.width >= width && reduced.height >= height) {
      return { bitmap: reduced, isFullSize: false };
    }
    reduced.close();
    return { bitmap: await decode(), isFullSize: true };
  } catch (e) {
    console.warn('Could not decode image at a reduced size, decoding it completely instead', e);
    return undefined;
  }
}

async function decodeCompletely(buffer: Uint8Array): Promise<Master> {
  return { bitmap: await createImageBitmap(new Blob([buffer])), isFullSize: true };
}

/** A master that is far larger than needed is replaced by a smaller one: it is only there to be scaled down */
async function reduce(master: Master, width: number, height: number): Promise<Master> {
  const scale = Math.max(width / master.bitmap.width, height / master.bitmap.height);
  if (scale * MASTER_HEADROOM * 1.5 >= 1) {
    return master;
  }
  try {
    const bitmap = await createImageBitmap(master.bitmap, {
      resizeWidth: Math.ceil(master.bitmap.width * scale * MASTER_HEADROOM),
      resizeHeight: Math.ceil(master.bitmap.height * scale * MASTER_HEADROOM),
      resizeQuality: 'high',
    });
    master.bitmap.close();
    return { bitmap, isFullSize: false };
  } catch (e) {
    return master;
  }
}

async function loadMaster(filePath: string, width: number, height: number): Promise<Master> {
  const buffer = await fse.readFile(filePath);
  const master = (await decodeJpeg(buffer, width, height)) ?? (await decodeCompletely(buffer));
  return reduce(master, width, height);
}

async function draw(request: ScreensaverImageRequest): Promise<OffscreenCanvas> {
  const { id, src, fallbackSrc, width, height } = request;
  let master = masters.get(id);
  const isLargeEnough = (m: Master) =>
    m.isFullSize || (m.bitmap.width >= width && m.bitmap.height >= height);
  if (master === undefined || !isLargeEnough(master)) {
    forget(id);
    try {
      master = await loadMaster(src, width, height);
    } catch (e) {
      if (fallbackSrc === undefined || fallbackSrc === src) {
        throw e;
      }
      master = await loadMaster(fallbackSrc, width, height);
    }
  }
  touch(id, master);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('No canvas context');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(master.bitmap, 0, 0, width, height);
  return canvas;
}

const ctx: Worker = self as any;

// One at a time: several photos being decoded at once only makes each of them slower
let queue: Promise<void> = Promise.resolve();
// Requests that were given up on while they were waiting for their turn
const cancelled = new Set<number>();

ctx.addEventListener('message', (event) => {
  const message = event.data as
    | ScreensaverImageRequest
    | ScreensaverImageForget
    | ScreensaverImageCancel;
  if (message.type === 'cancel') {
    // Not queued: it has to get ahead of the request it is about
    cancelled.add(message.requestId);
    return;
  }
  queue = queue.then(async () => {
    if (message.type === 'forget') {
      forget(message.id);
      return;
    }
    if (cancelled.delete(message.requestId)) {
      const response: ScreensaverImageResponse = {
        requestId: message.requestId,
        isCancelled: true,
      };
      ctx.postMessage(response);
      return;
    }
    try {
      const canvas = await draw(message);
      if (message.once) {
        forget(message.id);
      }
      if (message.encodeAs !== undefined) {
        const blob = await canvas.convertToBlob({ type: message.encodeAs, quality: 0.94 });
        const response: ScreensaverImageResponse = { requestId: message.requestId, blob };
        ctx.postMessage(response);
        return;
      }
      const bitmap = canvas.transferToImageBitmap();
      const response: ScreensaverImageResponse = { requestId: message.requestId, bitmap };
      ctx.postMessage(response, [bitmap]);
    } catch (e) {
      const response: ScreensaverImageResponse = {
        requestId: message.requestId,
        error: e instanceof Error ? e.message : String(e),
      };
      ctx.postMessage(response);
    }
  });
});
