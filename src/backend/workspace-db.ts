import Dexie from 'dexie';

import { WorkspaceRow } from 'common/workspace';

/**
 * Workspaces are kept in a database of their own. The library's database ('Allusion') keeps its schema
 * version, so that its backups can still be restored into Allusion; workspaces are not in those backups.
 */
export const WORKSPACE_DB_NAME = 'Atlas_Workspaces';

/**
 * The tiny version of an image that a workspace draws when it is small on screen (see `TileImages`), kept
 * so that it is not made again from the thumbnail after a restart, with the average colour of the image
 */
export interface TileRow {
  fileId: string;
  /** Which state of the file the tile was made of (`WorkspaceImageSource.version`): an older one is made again */
  version: string;
  color: string;
  image: Blob;
}

export class WorkspaceDatabase {
  private readonly db: Dexie;

  constructor(name = WORKSPACE_DB_NAME) {
    this.db = new Dexie(name);
    this.db.version(1).stores({ workspaces: 'id' });
    this.db.version(2).stores({ workspaces: 'id', tiles: 'fileId' });
  }

  private get workspaces(): Dexie.Table<WorkspaceRow, string> {
    return this.db.table('workspaces');
  }

  private get tiles(): Dexie.Table<TileRow, string> {
    return this.db.table('tiles');
  }

  /** The rows as they were stored, to be read with `workspaceFromRow` */
  async fetchAll(): Promise<unknown[]> {
    return this.workspaces.toArray();
  }

  async save(row: WorkspaceRow): Promise<void> {
    await this.workspaces.put(row);
  }

  async remove(id: string): Promise<void> {
    await this.workspaces.delete(id);
  }

  /** The kept tiles of these images, in the same order; undefined for those that have none */
  async fetchTiles(fileIds: string[]): Promise<(TileRow | undefined)[]> {
    return this.tiles.bulkGet(fileIds);
  }

  async saveTiles(rows: TileRow[]): Promise<void> {
    await this.tiles.bulkPut(rows);
  }
}
