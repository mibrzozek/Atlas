// This file is our connector for reading/writing EXIF metadata, using ExifTool under the hood.
// Initially I wanted to make use of the exiftool-vendored dependency, since it's seems
// quite nicely set-up and is still being maintained. Getting it to work in Electron
// was a real pain and I gave up. I read about others not being able to get it to work on MacOS
// and I can't test that personally, so I went with an alternative: node-exiftool.
// -
// The other one (exiftool-vendored) claims to have much better performance though,
// should give it another go sometime, perhaps even forking it and add better electron/webpack
// compatibility.

// Note about the terminology:
// - In Allusion, we call "tags" the labels you can assign to images
// - In ExifTool, any attribute in the metadata of an image is called a "tag"
//   The type of tags we use in Allusion are stored in the "Subject", "Keyword"
//   and "HierarchicalSubject" attributes - this last one being special, e.g. "Body | Arm | Hand"

/**
 * Braindump:
 * When we need to write:
 * - When tags are added/removed to a file (duh)
 * - When a tag is renamed: write it to all files tagged with it
 * - When a tag is moved to a different parent in the hierarchy: also write to all files
 * note: these should all be batchable
 *
 * When to read:
 * - When adding new location, like we currently do with image resolution (could replace that with exiftool)
 * - On start-up, look for changed tags (like we do with checking whether files still exist)
 * - On file-change (file watcher)
 * note: exiftool can read all files in a directory recursively
 *
 * Other things:
 * - Would be cool to show all exif info in inspector
 */

// v2: node exitfool
// TODO: Can read whole folder (batching): https://www.npmjs.com/package/node-exiftool#reading-directory
// Even subfolders with -r, e.g. remove all metadata in all subfolders using `exiftool -r -all= -overwrite_original MyFolder .`
// https://exiftool.org/#performance
// Capabilities
// - batch processing capabilities: the ability to process multiple files or entire directories with a single command
// - execute option may be used to perform multiple independent operations with a single invocation of exiftool
// finds:
// - automatically update Subject/Keywords when updating HierarchicalSubject: https://exiftool.org/forum/index.php?topic=9208.0
// Update: only doing an export/import for all images for now, not real-time updates
import { execFile } from 'child_process';
import fse from 'fs-extra';
import { action, makeObservable, observable, runInAction } from 'mobx';
import exiftool from 'node-exiftool';
import os from 'os';
import path from 'path';
import { READ_ONLY_MESSAGE, SOURCE_FILES_READ_ONLY } from './config';
import { IS_WIN } from './process';
import { getExtraResourcePath } from './fs';

// The exif binary is placed using ElectronBuilder's extraResources:
const exiftoolRunnable = IS_WIN ? 'exiftool.exe' : 'exiftool.pl';

const EXIF_TOOL_PATH = getExtraResourcePath(`exiftool/${exiftoolRunnable}`);

console.log('Exif tool path: ', EXIF_TOOL_PATH);
const ep = new exiftool.ExiftoolProcess(EXIF_TOOL_PATH);

const defaultWriteArgs = [
  'overwrite_original', // added this because it was leaving behind duplicate files (with _original appended to filename)
  'codedcharacterset=utf8', // needed for adobe products: https://www.npmjs.com/package/node-exiftool#writing-tags-for-adobe-in-utf8
  'P', // for preserving the modified date of files
];

/** Whether an Exif orientation means the camera was held sideways: the image is shown rotated by a quarter turn */
function isSidewaysOrientation(orientation: unknown): boolean {
  if (typeof orientation === 'number') {
    return orientation >= 5 && orientation <= 8;
  }
  return typeof orientation === 'string' && /90|270|transpose|transverse/i.test(orientation);
}

/** The formats for which the orientation is applied when they are displayed */
function isShownWithOrientation(filepath: string): boolean {
  return /[.](jpe?g|jfif|png|webp)$/i.test(filepath);
}

let argFileCounter = 0;

/** Set while the ExifTool process is starting or running: shared, since there is only one process */
let opening: Promise<void> | undefined;

export interface RawDimensions {
  /** The stored width, before any rotation is applied */
  width: number;
  height: number;
  /** Whether the image is shown rotated by a quarter turn, so with its width and height swapped */
  isSideways: boolean;
}

class ExifIO {
  @observable hierarchicalSeparator: string;

  // For accented characters and foreign alphabets, an extra arg is needed on Windows
  // https://www.npmjs.com/package/node-exiftool#reading-utf8-encoded-filename-on-windows
  extraArgs = IS_WIN ? ['charset filename=utf8'] : [];

  constructor(hierarchicalSeparator: string = '|') {
    this.hierarchicalSeparator = hierarchicalSeparator;

    makeObservable(this);
  }

  isOpen(): boolean {
    return ep._open || false;
  }

  /**
   * Starts the ExifTool process if it is not running yet. This can take several seconds the first time,
   * so the application does not wait for it when starting up: every method that needs it does.
   */
  async initialize(): Promise<ExifIO> {
    if (!ep._open) {
      if (opening === undefined) {
        opening = ep.open().then(
          (pid) => console.log('Started exiftool process %s', pid),
          (e) => {
            // So that it is tried again the next time it is needed
            opening = undefined;
            throw e;
          },
        );
      }
      await opening;
    }
    return this;
  }

  async close(): Promise<void> {
    if (ep._open) {
      console.log('Closing Exiftool...');
      await ep.close();
      console.log('Closed Exiftool');
    }
    opening = undefined;
  }

  @action.bound setHierarchicalSeparator(val: string): void {
    this.hierarchicalSeparator = val;
    localStorage.setItem('hierarchical-separator', val);
  }

  // ------------------

  /** Merges the HierarchicalSubject, Subject and Keywords into one list of tags, removing any duplicates */
  static convertMetadataToHierarchy(entry: exiftool.IMetadata, separator: string): string[][] {
    const parseExifFieldAsString = (val: any) =>
      Array.isArray(val) ? val : val?.toString() ? [val.toString()] : [];

    const tagHierarchy = parseExifFieldAsString(entry.HierarchicalSubject);
    const subject = parseExifFieldAsString(entry.Subject);
    const keywords = parseExifFieldAsString(entry.Keywords);

    // these toString() methods are here because they are automatically parsed to numbers if they could be numbers :/
    const splitHierarchy = tagHierarchy.map((h) => h.toString().split(separator));
    const allPlainTags = Array.from(
      new Set([...subject.map((s) => s.toString()), ...keywords.map((s) => s.toString())]),
    );

    // Filter out duplicates of tagHierarchy and the other plain tags:
    const filteredTags = allPlainTags.filter((tag) =>
      splitHierarchy.every((h) => h[h.length - 1] !== tag),
    );

    if (tagHierarchy.length + filteredTags.length > 0) {
      console.debug('Parsed tags', { tagHierarchy, subject, keywords });
    }
    return [...splitHierarchy, ...filteredTags.map((t) => [t])];
  }
  async readTags(filepath: string): Promise<string[][]> {
    await this.initialize();
    const metadata = await ep.readMetadata(filepath, [
      'HierarchicalSubject',
      'Subject',
      'Keywords',
      ...this.extraArgs,
    ]);
    if (metadata.error || !metadata.data?.[0]) {
      throw new Error(metadata.error || 'No metadata entry');
    }
    const entry = metadata.data[0];
    return ExifIO.convertMetadataToHierarchy(
      entry,
      runInAction(() => this.hierarchicalSeparator),
    );
  }

  async readExifTags(filepath: string, tags: string[]): Promise<(string | undefined)[]> {
    await this.initialize();
    const metadata = await ep.readMetadata(filepath, [...tags, ...this.extraArgs]);
    if (metadata.error || !metadata.data?.[0]) {
      throw new Error(metadata.error || 'No metadata entry');
    }
    const entry = metadata.data[0];
    return tags.map((t) => entry[t]?.toString() || undefined);
  }

  /** Reads file metadata for all files in a folder (and recursively for its subfolders) */
  // async readTagsRecursively(directory: string) {
  //   const metadata = await ep.readMetadata(directory, [
  //     'HierarchicalSubject',
  //     'Subject',
  //     'Keywords',
  //     'r',
  //   ]);
  //   if (metadata.error || !metadata.data?.[0]) {
  //     throw new Error(metadata.error || 'No metadata entries found');
  //   }
  //   const entry = metadata.data[0];
  //   return ExifIO.convertMetadataToHierarchy(
  //     entry,
  //     runInAction(() => this.hierarchicalSeparator),
  //   );
  // }

  /** Overwrites the tags of a specific file */
  @action.bound async writeTags(filepath: string, tagNameHierarchy: string[][]): Promise<void> {
    if (SOURCE_FILES_READ_ONLY) {
      throw new Error(READ_ONLY_MESSAGE);
    }
    // TODO: Could also write the meta-metadata, e.g.:
    // History Action                  : saved
    // History Instance ID             : xmp.iid:14020DA03863EB11B2D999D21045C35B
    // History When                    : 2021:01:30 21:20:41+01:00
    // History Software Agent          : Adobe Bridge CS6 (Windows)

    // Writing to multiple files: `exiftool -artist=me a.jpg b.jpg c.jpg`
    // Can add and remove simultaneously with `exiftool -keywords+="add this" -keywords-="remove this"`
    // Multiple at once with `-sep ", " -keywords="one, two, three"`

    if (!tagNameHierarchy.length) {
      return;
    }

    const subject = tagNameHierarchy.map((entry) => entry[entry.length - 1]);

    console.debug('Writing', tagNameHierarchy.join(', '), 'to', filepath);

    const res = await ep.writeMetadata(
      filepath,
      {
        HierarchicalSubject: tagNameHierarchy.map((hierarchy) =>
          hierarchy.join(this.hierarchicalSeparator),
        ),
        Subject: subject,
        Keywords: subject,
        // History: {},
      },
      [...defaultWriteArgs, ...this.extraArgs],
    );
    if (!res.error?.endsWith('1 image files updated')) {
      console.error('Could not update file tags metadata', res);
      throw new Error(res.error || 'Unknown error');
    }
  }

  /** Can be used to write arbitrary metadata. For "Subject" data (the "tags" in Allusion), use writeTags! */
  @action.bound async writeData(
    filepath: string,
    data: exiftool.IMetadata,
    opts?: {
      /** Only writes fields if they have not been set yet */
      onlyIfUndefined?: boolean;
    },
  ): Promise<void> {
    if (SOURCE_FILES_READ_ONLY) {
      throw new Error(READ_ONLY_MESSAGE);
    }
    console.debug('Writing', data, 'to', filepath);

    const args = [...defaultWriteArgs, ...this.extraArgs];

    let finalData = data;

    if (opts?.onlyIfUndefined) {
      const keys = Object.keys(data);
      const existingData = await this.readExifTags(filepath, keys);

      // Filter out keys from data that are already set
      // TODO: this probably doesn't work when writing multiple fields at once
      // exiftool has a built-in option for this but can't get it to work
      // https://exiftool.org/forum/index.php?topic=6519.0
      const fieldsToWrite = existingData
        .filter((value) => !value || (Array.isArray(value) && value.length === 0))
        .map((_, index) => keys[index]);

      if (fieldsToWrite.length === 0) {
        return;
      }

      finalData = {};
      fieldsToWrite.forEach((key) => {
        finalData[key] = data[key];
      });
    }

    const res = await ep.writeMetadata(filepath, finalData, args);

    if (!res.error?.endsWith('1 image files updated')) {
      console.error('Could not update file metadata', res);
      throw new Error(res.error || 'Unknown error');
    }
  }

  /** Adds */
  // async addTag(files: string[], tagHierarchy: string[]) {
  //   // concat file paths into one big string, each surrounded by double quotes
  //   const command = files.map((filePath) => `"${filePath}"`).join(' ');
  //   const res = await ep.writeMetadata(
  //     command,
  //     // the "MyHS" is a custom exiftool tag, see the .Exilfool_config file for more details
  //     { 'MyHS+': tagHierarchy },
  //     ['overwrite_original '], // added this because it was leaving behind duplicate files (with _original appended to filename)
  //   );
  //   if (!res.error?.endsWith(`${files.length} image files updated`)) {
  //     console.error('Could not update file metadata', res);
  //   }
  // }
  // async removeTag(files: string[], tagHierarchy: string[]) {
  //   const command = files.map((filePath) => `"${filePath}"`).join(' ');
  //   const res = await ep.writeMetadata(command, { 'MyHS-': tagHierarchy }, ['overwrite_original ']);
  //   if (!res.error?.endsWith(`${files.length} image files updated`)) {
  //     console.error('Could not update file metadata', res);
  //   }
  // }
  // async replaceTag(files: string[], oldTagHierarchy: string[], newTagHierarchy: string[]) {
  //   const command = files.map((filePath) => `"${filePath}"`).join(' ');
  //   const res = await ep.writeMetadata(
  //     command,
  //     {
  //       'MyHS-': oldTagHierarchy,
  //       'MyHS+': newTagHierarchy,
  //     },
  //     ['overwrite_original '], // added this because it was leaving behind duplicate files (with _original appended to filename)
  //   );
  //   if (!res.error?.endsWith(`${files.length} image files updated`)) {
  //     console.error('Could not update file metadata', res);
  //   }
  // }

  /**
   * Extracts the width and height resolution of an image file from its exif data, as it is displayed:
   * for a photo taken with the camera held sideways, the stored width and height are swapped.
   * @param filepath The file to read the resolution from
   * @returns The width and height of the image, or width and height as 0 if the resolution could not be determined.
   */
  async getDimensions(filepath: string): Promise<{ width: number; height: number }> {
    let metadata: Awaited<ReturnType<typeof ep.readMetadata>> | undefined = undefined;
    try {
      await this.initialize();
      metadata = await ep.readMetadata(filepath, [
        's3',
        'ImageWidth',
        'ImageHeight',
        'Orientation',
        ...this.extraArgs,
      ]);
      if (metadata.error || !metadata.data?.[0]) {
        throw new Error(metadata.error || 'No metadata entry');
      }
      const entry = metadata.data[0];
      const { ImageWidth, ImageHeight, Orientation } = entry;
      if (isShownWithOrientation(filepath) && isSidewaysOrientation(Orientation)) {
        return { width: ImageHeight, height: ImageWidth };
      }
      return { width: ImageWidth, height: ImageHeight };
    } catch (e) {
      console.error('Could not read image dimensions from ', filepath, e, metadata);
      return { width: 0, height: 0 };
    }
  }

  /**
   * Reads the stored dimensions and orientation of many files at once, which is a lot faster than one by one.
   * Files that cannot be read, or for which the orientation is not applied when shown, are left out.
   */
  async readRawDimensions(filepaths: string[]): Promise<Map<string, RawDimensions>> {
    const result = new Map<string, RawDimensions>();
    const candidates = filepaths.filter(isShownWithOrientation);
    if (candidates.length === 0) {
      return result;
    }
    // Passed in a file: there is a limit to the length of a command
    // This can be called several times at once: every call needs its own file
    const argFile = path.join(
      os.tmpdir(),
      `atlas-exiftool-args-${process.pid}-${Date.now()}-${argFileCounter++}.txt`,
    );
    await fse.writeFile(argFile, candidates.join(os.EOL), 'utf8');
    try {
      const output = await new Promise<string>((resolve, reject) =>
        execFile(
          EXIF_TOOL_PATH,
          // prettier-ignore
          ['-charset', 'filename=utf8', '-json', '-n', '-fast2', '-Orientation', '-ImageWidth', '-ImageHeight', '-@', argFile],
          { maxBuffer: 256 * 1024 * 1024, windowsHide: true },
          // It exits with an error code when any of the files could not be read: the others are still in the output
          (error, stdout) => (stdout ? resolve(stdout) : reject(error)),
        ),
      );
      const normalize = (p: string) => path.normalize(p).toLowerCase();
      const originalPaths = new Map(candidates.map((p) => [normalize(p), p]));
      for (const entry of JSON.parse(output)) {
        const filepath = originalPaths.get(normalize(entry.SourceFile));
        if (filepath !== undefined && entry.ImageWidth > 0 && entry.ImageHeight > 0) {
          result.set(filepath, {
            width: entry.ImageWidth,
            height: entry.ImageHeight,
            isSideways: isSidewaysOrientation(entry.Orientation),
          });
        }
      }
    } finally {
      fse.remove(argFile).catch(console.error);
    }
    return result;
  }

  /**
   * Extracts the embedded thumbnail of a file into its own separate image file
   * @param input
   * @param output
   * @returns Whether the thumbnail could be extracted successfully
   */
  async extractThumbnail(input: string, output: string): Promise<boolean> {
    // TODO: should be possible to pipe it immediately. Node-exiftool doesn't seem to allow that
    // const manualCommand = `"${input}" -PhotoshopThumbnail -b > "${output}"`;
    // console.log(manualCommand);
    // const res = await ep.readMetadata(manualCommand);
    // console.log(res);

    // TODO: can also extract preview from RAW https://exiftool.org/forum/index.php?topic=7408.0

    await this.initialize();

    const res = await ep.readMetadata(input, ['ThumbnailImage', 'PhotoshopThumbnail', 'b']);

    let data = res.data?.[0]?.ThumbnailImage || res.data?.[0]?.PhotoshopThumbnail;
    if (data) {
      if (data.startsWith?.('base64')) {
        data = data.replace('base64:', '');
        await fse.writeFile(output, Buffer.from(data, 'base64'));
      } else {
        await fse.writeFile(output, data);
      }
      return true;
    }
    return false;
  }
}

export default ExifIO;
