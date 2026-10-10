import fse from 'fs-extra';
import path from 'path';
import { useEffect } from 'react';

import { thumbnailFormat } from 'common/config';
import { ID } from '../../api/id';
import { ClientFile } from '../entities/File';

export interface IThumbnailMessage {
  filePath: string;
  fileId: ID;
  thumbnailFilePath: string;
  thumbnailFormat: string;
}

/** What is needed of a file to generate its thumbnail */
export type ThumbnailTarget = Pick<
  ClientFile,
  'id' | 'extension' | 'absolutePath' | 'thumbnailPath' | 'width' | 'height' | 'setThumbnailPath'
>;

export interface IThumbnailMessageResponse {
  fileId: ID;
  thumbnailPath: string;
}

// TODO: Look into NativeImage operators: https://www.electronjs.org/docs/api/native-image#imageresizeoptions

// Set up multiple workers for max performance
const NUM_THUMBNAIL_WORKERS = 4;
const workers: Worker[] = [];
for (let i = 0; i < NUM_THUMBNAIL_WORKERS; i++) {
  workers[i] = new Worker(
    new URL('src/frontend/workers/thumbnailGenerator.worker', import.meta.url),
  );
}

// Keep in sync with MAX_PARALLEL_THUMBNAILS in the worker, so that jobs never have to wait inside of a worker
const MAX_JOBS_PER_WORKER = 4;
/** How long a worker may take for a single thumbnail, counted from the moment it is handed to the worker */
const JOB_TIMEOUT = 10000;

type Callback = (success: boolean) => void;

interface Job {
  msg: IThumbnailMessage;
  /** Callback functions for when thumbnail generation is finished or has failed */
  callbacks: Callback[];
  /** The index of the worker it was handed to: undefined while it is still waiting */
  worker?: number;
  timer?: number;
}

const jobs = new Map<ID, Job>();
/**
 * The jobs that have not been handed to a worker yet. The last one is processed first:
 * the images that were requested most recently are the ones the user is looking at.
 * Background jobs are put at the start, so they only run when nothing else is waiting.
 */
const waiting: ID[] = [];
const workerLoad = workers.map(() => 0);

function dispatchJobs() {
  while (waiting.length > 0) {
    const worker = workerLoad.indexOf(Math.min(...workerLoad));
    if (workerLoad[worker] >= MAX_JOBS_PER_WORKER) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = waiting.pop()!;
    const job = jobs.get(id);
    if (job !== undefined) {
      job.worker = worker;
      job.timer = window.setTimeout(() => finishJob(id, false), JOB_TIMEOUT);
      workerLoad[worker]++;
      workers[worker].postMessage(job.msg);
    }
  }
}

/** @returns Whether a job was found for the given file ID */
function finishJob(id: ID, success: boolean): boolean {
  const job = jobs.get(id);
  if (job === undefined) {
    return false;
  }
  jobs.delete(id);
  clearTimeout(job.timer);
  if (job.worker !== undefined) {
    workerLoad[job.worker]--;
  }
  job.callbacks.forEach((cb) => cb(success));
  dispatchJobs();
  return true;
}

/**
 * Generates a thumbnail in a Worker: {@link ../workers/thumbnailGenerator.worker}
 * When the worker is finished, the file.thumbnailPath will be updated with ?v=1,
 * causing the image to update in the view where ever it is used
 * @param background Whether to wait until there are no other thumbnails to generate
 **/
export const generateThumbnailUsingWorker = (
  file: Pick<ClientFile, 'id' | 'absolutePath'>,
  thumbnailFilePath: string,
  background = false,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const callback: Callback = (success) => (success ? resolve() : reject());

    // Might already be requested earlier
    const existingJob = jobs.get(file.id);
    if (existingJob !== undefined) {
      existingJob.callbacks.push(callback);
      // It is needed right now: move it to the front
      if (!background && existingJob.worker === undefined) {
        const index = waiting.lastIndexOf(file.id);
        if (index !== -1) {
          waiting.splice(index, 1);
          waiting.push(file.id);
        }
      }
      return;
    }

    jobs.set(file.id, {
      msg: { filePath: file.absolutePath, thumbnailFilePath, thumbnailFormat, fileId: file.id },
      callbacks: [callback],
    });
    if (background) {
      waiting.unshift(file.id);
    } else {
      waiting.push(file.id);
    }
    dispatchJobs();
  });

/**
 * Listens and processes events from the Workers. Should only be used once in the entire app
 * TODO: no need for this to be a hook anymore, should just make a class out of it
 */
export const useWorkerListener = () => {
  useEffect(() => {
    for (let i = 0; i < workers.length; i++) {
      workers[i].onmessage = (e: { data: IThumbnailMessageResponse }) => {
        const { fileId } = e.data;

        if (!finishJob(fileId, true)) {
          console.debug(
            'No callbacks found for fileId after successful thumbnail creation:',
            fileId,
            'Might have timed out',
          );
        }
      };

      workers[i].onerror = (err) => {
        console.error('Could not generate thumbnail', `worker ${i}`, err);
        const fileId = err.message;

        if (!finishJob(fileId, false)) {
          console.debug(
            'No callbacks found for fileId after unsuccessful thumbnail creation:',
            fileId,
            'Might have timed out',
          );
        }
      };
    }
    return () => workers.forEach((worker) => worker.terminate());
  }, []);
};

// Moves all thumbnail files from one directory to another
export const moveThumbnailDir = async (sourceDir: string, targetDir: string) => {
  if (!(await fse.pathExists(sourceDir)) || !(await fse.pathExists(targetDir))) {
    console.log('Source or target directory does not exist for moving thumbnails');
    return;
  }

  console.log('Moving thumbnails from ', sourceDir, ' to ', targetDir);

  const files = await fse.readdir(sourceDir);
  for (const file of files) {
    if (file.endsWith(thumbnailFormat)) {
      const oldPath = path.join(sourceDir, file);
      const newPath = path.join(targetDir, file);
      await fse.move(oldPath, newPath);
    }
  }
};
