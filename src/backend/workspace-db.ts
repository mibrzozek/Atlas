import Dexie from 'dexie';

import { WorkspaceRow } from 'common/workspace';

/**
 * Workspaces are kept in a database of their own. The library's database ('Allusion') keeps its schema
 * version, so that its backups can still be restored into Allusion; workspaces are not in those backups.
 */
export const WORKSPACE_DB_NAME = 'Atlas_Workspaces';

export class WorkspaceDatabase {
  private readonly db: Dexie;

  constructor(name = WORKSPACE_DB_NAME) {
    this.db = new Dexie(name);
    this.db.version(1).stores({ workspaces: 'id' });
  }

  private get workspaces(): Dexie.Table<WorkspaceRow, string> {
    return this.db.table('workspaces');
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
}
