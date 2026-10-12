import { ScreensaverImage } from 'common/screensaver';
import type {
  ScreensaverImageForget,
  ScreensaverImageRequest,
  ScreensaverImageResponse,
} from '../workers/screensaverImage.worker';

// Decoding the first screens of photos is what the start waits for: spread it over the processor,
// but leave room for the rest of the system
const NUM_WORKERS = Math.min(6, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));

/**
 * Draws the images of the screensaver at the exact size they are shown at, in background threads:
 * the thread that runs the animation never decodes or scales an image.
 */
export class ScreensaverImages {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<
    number,
    { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }
  >();
  private nextRequestId = 0;
  private isDisposed = false;

  constructor() {
    for (let i = 0; i < NUM_WORKERS; i++) {
      const worker = new Worker(
        new URL('src/frontend/workers/screensaverImage.worker', import.meta.url),
      );
      worker.onmessage = (event: MessageEvent<ScreensaverImageResponse>) => {
        const { requestId, bitmap, error } = event.data;
        const request = this.pending.get(requestId);
        this.pending.delete(requestId);
        if (request === undefined) {
          bitmap?.close();
        } else if (bitmap !== undefined) {
          request.resolve(bitmap);
        } else {
          request.reject(new Error(error ?? 'Could not draw image'));
        }
      };
      this.workers.push(worker);
    }
  }

  /** Always the same thread for an image: that one has its decoded copy */
  private workerOf(image: ScreensaverImage): Worker {
    let hash = 0;
    for (let i = 0; i < image.id.length; i++) {
      hash = (hash * 31 + image.id.charCodeAt(i)) >>> 0;
    }
    return this.workers[hash % this.workers.length];
  }

  /**
   * @param width The size to draw it at, in device pixels
   * @returns A bitmap of exactly that size. Whoever gets it has to close it, or hand it to a canvas
   */
  draw(image: ScreensaverImage, width: number, height: number): Promise<ImageBitmap> {
    if (this.isDisposed) {
      return Promise.reject(new Error('The screensaver has ended'));
    }
    return new Promise((resolve, reject) => {
      const requestId = this.nextRequestId++;
      this.pending.set(requestId, { resolve, reject });
      const request: ScreensaverImageRequest = {
        type: 'draw',
        requestId,
        id: image.id,
        src: image.src,
        fallbackSrc: image.fallbackSrc,
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
      this.workerOf(image).postMessage(request);
    });
  }

  /** The image left the screen: its decoded copy can go */
  forget(image: ScreensaverImage): void {
    if (!this.isDisposed) {
      const message: ScreensaverImageForget = { type: 'forget', id: image.id };
      this.workerOf(image).postMessage(message);
    }
  }

  dispose(): void {
    this.isDisposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    for (const request of this.pending.values()) {
      request.reject(new Error('The screensaver has ended'));
    }
    this.pending.clear();
  }
}
