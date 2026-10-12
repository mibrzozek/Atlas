import { SharpSize } from 'common/sharp-size';
import type {
  ScreensaverImageCancel,
  ScreensaverImageRequest,
  ScreensaverImageResponse,
} from '../workers/screensaverImage.worker';

/**
 * Images for the gallery that are larger on screen than their thumbnail.
 *
 * A thumbnail is at most `thumbnailMaxSize` pixels. Stretched over a larger cell it is blurry, and showing the
 * photo itself instead meant decoding all 20 megapixels of it on the way, which made scrolling stutter.
 * Here the photo is decoded in a background thread, at a fraction of its size, and scaled to exactly the
 * pixels the cell has. The gallery shows the thumbnail meanwhile and swaps this in when it is ready.
 */

/** Formats without transparency: these are handed back as JPEG, which is the fastest to make */
const OPAQUE = new Set(['jpg', 'jpeg', 'jfif', 'bmp']);

const NUM_WORKERS = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
/** How many drawn images are kept, for cells that come back into view */
const MAX_CACHED = 240;

interface Job {
  requestId: number;
  worker: Worker;
  promise: Promise<string>;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
  /** How many cells are waiting for it */
  users: number;
}

class SharpImages {
  private workers: Worker[] | undefined;
  private nextRequestId = 0;
  private readonly jobs = new Map<string, Job>();
  /** Object URLs of the drawn images, least recently used first */
  private readonly cache = new Map<string, string>();

  private getWorker(id: string): Worker {
    if (this.workers === undefined) {
      this.workers = [];
      for (let i = 0; i < NUM_WORKERS; i++) {
        const worker = new Worker(
          new URL('src/frontend/workers/screensaverImage.worker', import.meta.url),
        );
        worker.onmessage = (event: MessageEvent<ScreensaverImageResponse>) =>
          this.handleResponse(event.data);
        this.workers.push(worker);
      }
    }
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return this.workers[hash % this.workers.length];
  }

  private handleResponse({ requestId, blob, error, isCancelled }: ScreensaverImageResponse) {
    for (const [key, job] of this.jobs) {
      if (job.requestId !== requestId) {
        continue;
      }
      this.jobs.delete(key);
      if (blob !== undefined) {
        const url = URL.createObjectURL(blob);
        this.remember(key, url);
        job.resolve(url);
      } else {
        job.reject(new Error(isCancelled ? 'Cancelled' : error ?? 'Could not draw image'));
      }
      return;
    }
  }

  private remember(key: string, url: string) {
    this.cache.set(key, url);
    for (const [oldKey, oldUrl] of this.cache) {
      if (this.cache.size <= MAX_CACHED) {
        break;
      }
      // An image that is on screen keeps what it has loaded; only loading it anew needs the URL
      URL.revokeObjectURL(oldUrl);
      this.cache.delete(oldKey);
    }
  }

  /** The image when it was drawn at this size before, right away */
  peek(id: string, size: SharpSize): string | undefined {
    const key = `${id}:${size.width}x${size.height}`;
    const url = this.cache.get(key);
    if (url !== undefined) {
      // Most recently used
      this.cache.delete(key);
      this.cache.set(key, url);
    }
    return url;
  }

  /**
   * Draws the image at the given size.
   * @returns The URL of the drawn image, and a function to call when it is no longer wanted
   */
  request(
    image: { id: string; absolutePath: string; extension: string },
    size: SharpSize,
  ): { promise: Promise<string>; cancel: () => void } {
    const cached = this.peek(image.id, size);
    if (cached !== undefined) {
      return { promise: Promise.resolve(cached), cancel: () => undefined };
    }
    const key = `${image.id}:${size.width}x${size.height}`;
    let job = this.jobs.get(key);
    if (job === undefined) {
      const requestId = this.nextRequestId++;
      const worker = this.getWorker(image.id);
      let resolve!: (url: string) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Nobody may be listening any more by the time it fails
      promise.catch(() => undefined);
      job = { requestId, worker, promise, resolve, reject, users: 0 };
      this.jobs.set(key, job);
      const request: ScreensaverImageRequest = {
        type: 'draw',
        requestId,
        id: image.id,
        src: image.absolutePath,
        width: size.width,
        height: size.height,
        encodeAs: OPAQUE.has(image.extension) ? 'image/jpeg' : 'image/webp',
        once: true,
      };
      worker.postMessage(request);
    }
    job.users++;
    const current = job;
    let isCancelled = false;
    return {
      promise: current.promise,
      cancel: () => {
        if (isCancelled) {
          return;
        }
        isCancelled = true;
        current.users--;
        // Scrolled past before it was its turn: do not decode it at all
        if (current.users === 0 && this.jobs.get(key) === current) {
          // Forgotten right away: a cell that asks for it again starts a new request
          this.jobs.delete(key);
          current.reject(new Error('Cancelled'));
          const message: ScreensaverImageCancel = { type: 'cancel', requestId: current.requestId };
          current.worker.postMessage(message);
        }
      },
    };
  }
}

export const sharpImages = new SharpImages();
