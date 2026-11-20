import fse from 'fs-extra';
import SysPath from 'path';
import React from 'react';

import { Button } from 'widgets';
import { RendererMessenger } from '../../../ipc/renderer';

/**
 * The folders pictures and videos were saved in last: where the folder dialogs open, and what a new
 * workspace saves to until one is chosen
 */
export const PICTURE_FOLDER_KEY = 'Atlas_WorkspacePictureFolder';
export const VIDEO_FOLDER_KEY = 'Atlas_WorkspaceVideoFolder';

export function storedFolder(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    // Only where the dialogs open
    return undefined;
  }
}

export function rememberFolder(key: string, folder: string): void {
  try {
    localStorage.setItem(key, folder);
  } catch {
    // Only where the dialogs open next time
  }
}

/** The folder a new workspace saves to until one is chosen: where pictures or videos were saved last */
export function lastSaveFolder(): string | undefined {
  return storedFolder(PICTURE_FOLDER_KEY) ?? storedFolder(VIDEO_FOLDER_KEY);
}

/** The folder, if it still is there */
export async function existingFolder(folder: string | undefined): Promise<string | undefined> {
  return folder !== undefined && (await fse.pathExists(folder)) ? folder : undefined;
}

/** Asks for a folder to save to, opening at `defaultPath`; undefined when none was chosen */
export async function chooseSaveFolder(
  title: string,
  defaultPath?: string,
): Promise<string | undefined> {
  const { filePaths } = await RendererMessenger.showOpenDialog({
    title,
    buttonLabel: 'Save here',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  return filePaths[0];
}

/**
 * The folder a save goes to, as a save dialog shows it: by its name, and a Change… that picks another one
 * for this save only (the workspace keeps its own)
 */
export const SavesTo = ({
  folder,
  title,
  onChange,
}: {
  folder: string;
  /** What the folder dialog asks for, when Change… is pressed */
  title: string;
  onChange: (folder: string) => void;
}) => (
  <div className="workspace-dialog-saves-to">
    <span data-tooltip={folder}>
      Saves to <b>{SysPath.basename(folder) || folder}</b>
    </span>
    <Button
      styling="outlined"
      text="Change…"
      tooltip="Save this one to another folder"
      onClick={async () => {
        const picked = await chooseSaveFolder(title, folder);
        if (picked !== undefined) {
          onChange(picked);
        }
      }}
    />
  </div>
);
