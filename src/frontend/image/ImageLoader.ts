import fse from 'fs-extra';
import { action } from 'mobx';
import StreamZip from 'node-stream-zip';

import ExifIO from 'common/ExifIO';
import { thumbnailMaxSize } from 'common/config';
import { encodeFilePath } from 'common/fs';
import { FileDTO, IMG_EXTENSIONS_TYPE } from '../../api/file';
import { ClientFile } from '../entities/File';
import ExrLoader from './ExrLoader';
import PsdLoader from './PSDLoader';
import { ThumbnailTarget, generateThumbnailUsingWorker } from './ThumbnailGeneration';
import TifLoader from './TifLoader';
import { generateThumbnail, getBlob } from './util';

type FormatHandlerType =
  | 'web'
  | 'tifLoader'
  | 'exrLoader'
  | 'psdLoader'
  | 'extractEmbeddedThumbnailOnly'
  | 'none';

const FormatHandlers: Record<IMG_EXTENSIONS_TYPE, FormatHandlerType> = {
  gif: 'web',
  png: 'web',
  apng: 'web',
  jpg: 'web',
  jpeg: 'web',
  jfif: 'web',
  webp: 'web',
  bmp: 'web',
  ico: 'web',
  svg: 'none',
  tif: 'tifLoader',
  tiff: 'tifLoader',
  psd: 'psdLoader',
  kra: 'extractEmbeddedThumbnailOnly',
  // xcf: 'extractEmbeddedThumbnailOnly',
  exr: 'exrLoader',
  // avif: 'sharp',
};

type ObjectURL = string;

class ImageLoader {
  private tifLoader: TifLoader;
  private exrLoader: ExrLoader;
  private psdLoader: PsdLoader;

  private srcBufferCache: WeakMap<ClientFile, ObjectURL> = new WeakMap();
  private bufferCacheTimer: WeakMap<ClientFile, number> = new WeakMap();
  /** The files for which the thumbnail has already been checked or generated ahead of time during this session */
  private pregeneratedIds = new Set<string>();
  /** The images that were most recently decoded ahead of time: kept so that their decoded data is not thrown away */
  private preloadedImages: { url: string; image: HTMLImageElement; decoded: Promise<boolean> }[] =
    [];

  constructor(private exifIO: ExifIO) {
    this.tifLoader = new TifLoader();
    this.exrLoader = new ExrLoader();
    this.psdLoader = new PsdLoader();
    this.ensureThumbnail = action(this.ensureThumbnail.bind(this));
  }

  async init(): Promise<void> {
    await Promise.all([this.tifLoader.init(), this.exrLoader.init(), this.psdLoader.init()]);
  }

  needsThumbnail(file: Pick<FileDTO, 'extension' | 'width' | 'height'>) {
    // Not using thumbnails for gifs, since they're mostly used for animations, which doesn't get preserved in thumbnails
    if (file.extension === 'gif') {
      return false;
    }

    return (
      FormatHandlers[file.extension] !== 'web' ||
      file.width > thumbnailMaxSize ||
      file.height > thumbnailMaxSize
    );
  }

  /**
   * Ensures a thumbnail exists, will return instantly if already exists.
   * @param file The file to generate a thumbnail for
   * @param background Whether generating it can wait until no other thumbnails are requested
   * @returns Whether a thumbnail had to be generated
   * @throws When a thumbnail does not exist and cannot be generated
   */
  async ensureThumbnail(file: ThumbnailTarget, background = false): Promise<boolean> {
    const { extension, absolutePath, thumbnailPath } = {
      extension: file.extension,
      absolutePath: file.absolutePath,
      // remove ?v=1 that might have been added after the thumbnail was generated earlier
      thumbnailPath: file.thumbnailPath.split('?v=1')[0],
    };

    // The image is its own thumbnail: there is nothing to generate, and it may never be written to
    if (thumbnailPath === absolutePath) {
      return false;
    }

    if (await fse.pathExists(thumbnailPath)) {
      // Files like PSDs have a tendency to change: Check if thumbnail needs an update
      const fileStats = await fse.stat(absolutePath);
      const thumbStats = await fse.stat(thumbnailPath);
      if (fileStats.mtime < thumbStats.ctime) {
        return false; // if file mod date is before thumbnail creation date, keep using the same thumbnail
      }
    }

    const handlerType = FormatHandlers[extension];
    switch (handlerType) {
      case 'web':
        await generateThumbnailUsingWorker(file, thumbnailPath, background);
        updateThumbnailPath(file, thumbnailPath);
        break;
      case 'tifLoader':
        // Also done in the workers: decoding them here would freeze the interface
        await generateThumbnailUsingWorker(file, thumbnailPath, background);
        updateThumbnailPath(file, thumbnailPath);
        break;
      case 'exrLoader':
        await generateThumbnail(this.exrLoader, absolutePath, thumbnailPath, thumbnailMaxSize);
        updateThumbnailPath(file, thumbnailPath);
        break;
      case 'extractEmbeddedThumbnailOnly':
        let success = false;
        // Custom logic for specific file formats
        if (extension === 'kra') {
          success = await this.extractKritaThumbnail(absolutePath, thumbnailPath);
        } else {
          // Fallback to extracting thumbnail using exiftool (works for PSD and some other formats)
          success = await this.exifIO.extractThumbnail(absolutePath, thumbnailPath);
        }
        if (!success) {
          // There might not be an embedded thumbnail
          throw new Error('Could not generate or extract thumbnail');
        } else {
          updateThumbnailPath(file, thumbnailPath);
        }
        break;
      case 'psdLoader':
        await generateThumbnail(this.psdLoader, absolutePath, thumbnailPath, thumbnailMaxSize);
        updateThumbnailPath(file, thumbnailPath);
        break;
      case 'none':
        // No thumbnail for this format
        file.setThumbnailPath(file.absolutePath);
        break;
      default:
        console.warn('Unsupported extension', file.absolutePath, file.extension);
        throw new Error('Unsupported extension ' + file.absolutePath);
    }
    return true;
  }

  /**
   * Generates the missing thumbnails of the given files ahead of time, at a low priority,
   * so they are ready by the time they are scrolled into view.
   * Only for formats that are processed in the thumbnail workers: the others would make the UI stutter.
   */
  async pregenerateThumbnails(files: ThumbnailTarget[], isCancelled: () => boolean): Promise<void> {
    const MAX_PENDING = 4;
    let nextIndex = 0;
    const processNext = async () => {
      while (nextIndex < files.length && !isCancelled()) {
        const file = files[nextIndex++];
        if (
          !this.pregeneratedIds.has(file.id) &&
          (FormatHandlers[file.extension] === 'web' ||
            FormatHandlers[file.extension] === 'tifLoader') &&
          this.needsThumbnail(file)
        ) {
          // Failures are dealt with when the image is actually shown
          await this.ensureThumbnail(file, true).catch(() => undefined);
          this.pregeneratedIds.add(file.id);
        }
      }
    };
    await Promise.all(Array.from({ length: MAX_PENDING }, processNext));
  }

  async getImageSrc(file: ClientFile): Promise<string | undefined> {
    const handlerType = FormatHandlers[file.extension];
    switch (handlerType) {
      case 'web':
        return file.absolutePath;
      case 'tifLoader': {
        const src =
          this.srcBufferCache.get(file) ?? (await getBlob(this.tifLoader, file.absolutePath));
        // Store in cache for a while, so it loads quicker when going back and forth
        this.updateCache(file, src);
        return src;
      }
      case 'exrLoader': {
        const src =
          this.srcBufferCache.get(file) ?? (await getBlob(this.exrLoader, file.absolutePath));
        // Store in cache for a while, so it loads quicker when going back and forth
        this.updateCache(file, src);
        return src;
      }
      case 'psdLoader':
        const src =
          this.srcBufferCache.get(file) ?? (await getBlob(this.psdLoader, file.absolutePath));
        this.updateCache(file, src);
        return src;
      // TODO: krita has full image also embedded (mergedimage.png)
      case 'extractEmbeddedThumbnailOnly':
      case 'none':
        return undefined;
      default:
        console.warn('Unsupported extension', file.absolutePath, file.extension);
        return undefined;
    }
  }

  /**
   * Loads and decodes the full image in the background, so it can be shown without delay when it is opened.
   * @param anyFormat Whether to include formats that have to be converted first, which is slow
   * @returns Whether the image has been decoded
   */
  async preloadImage(file: ClientFile, anyFormat = false): Promise<boolean> {
    if (!anyFormat && FormatHandlers[file.extension] !== 'web') {
      return false;
    }
    const src = await this.getImageSrc(file);
    if (src === undefined) {
      return false;
    }
    const url = encodeFilePath(src);
    const preloaded = this.preloadedImages.find((preloaded) => preloaded.url === url);
    if (preloaded !== undefined) {
      return preloaded.decoded;
    }
    const image = new Image();
    image.src = url;
    const decoded = image.decode().then(
      () => true,
      () => false,
    );
    this.preloadedImages.push({ url, image, decoded });
    if (this.preloadedImages.length > 4) {
      this.preloadedImages.shift();
    }
    return decoded;
  }

  /** Returns 0 for width and height if they can't be determined */
  async getImageResolution(absolutePath: string): Promise<{ width: number; height: number }> {
    // ExifTool should be able to read the resolution from any image file
    const dimensions = await this.exifIO.getDimensions(absolutePath);

    // User report: Resolution can't be found for PSD files.
    // Can't reproduce myself, but putting a check in place anyway. Maybe due to old PSD format?
    // Read the actual file using the PSD loader and get the resolution from there.
    if (
      absolutePath.toLowerCase().endsWith('psd') &&
      (dimensions.width === 0 || dimensions.height === 0)
    ) {
      try {
        const psdData = await this.psdLoader.decode(await fse.readFile(absolutePath));
        dimensions.width = psdData.width;
        dimensions.height = psdData.height;
      } catch (e) {}
    }

    return dimensions;
  }

  private async extractKritaThumbnail(absolutePath: string, outputPath: string) {
    const zip = new StreamZip.async({ file: absolutePath });
    let success = false;
    console.debug('Extracting thumbnail from', absolutePath);
    try {
      const count = await zip.extract('preview.png', outputPath);
      success = count === 1;
    } catch (e) {
      console.error('Could not extract thumbnail from .kra file', absolutePath, e);
    } finally {
      zip.close().catch(console.warn);
    }
    return success;
  }

  private updateCache(file: ClientFile, src: ObjectURL) {
    this.srcBufferCache.set(file, src);
    const timer = this.bufferCacheTimer.get(file);
    clearTimeout(timer);
    this.bufferCacheTimer.set(
      file,
      window.setTimeout(() => {
        URL.revokeObjectURL(src);
        this.srcBufferCache.delete(file);
      }, 60_000),
    );
  }
}

export default ImageLoader;

// Update the thumbnail path to re-render the image where ever it is used in React
const updateThumbnailPath = action((file: ThumbnailTarget, thumbnailPath: string) => {
  file.thumbnailPath = `${thumbnailPath}?v=1`;
});
