import { runInAction } from 'mobx';
import SysPath from 'path';

import { DnDFolderType, DnDLocationType, DnDTagType } from '../../contexts/TagDnDContext';
import { ClientTagSearchCriteria, folderCriteria } from '../../entities/SearchCriteria';
import RootStore from '../../stores/RootStore';
import { LibraryBatch } from '../../stores/WorkspaceStore';
import { COLLECTION_DND_TYPE } from '../Outliner/CollectionsPanel/useCollectionDnD';

/** Images dragged out of the gallery leave as files, the way they would be dropped in a folder */
const FILES = 'Files';

const LIBRARY_TYPES = [DnDTagType, COLLECTION_DND_TYPE, DnDLocationType, DnDFolderType, FILES];

/**
 * Whether a drag carries something of the Library that a workspace takes: a tag, a collection, a source
 * or a folder of it from the side panel, or images from the gallery. Known while dragging, before the drop.
 */
export function carriesLibraryBatch(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.some((type) => LIBRARY_TYPES.includes(type));
}

/**
 * The effect to show over a workspace: one the drag allows, or the drop is refused. Tags and sources
 * allow 'link' and 'move', collections 'move', images from the gallery 'copy'.
 */
export function dropEffectFor(dataTransfer: DataTransfer): DataTransfer['dropEffect'] {
  const allowed = dataTransfer.effectAllowed;
  return /copy|all|uninitialized/i.test(allowed) ? 'copy' : /link/i.test(allowed) ? 'link' : 'move';
}

/** What was dropped, as a batch for a workspace; undefined when it is nothing of the Library */
export function readLibraryBatch(
  dataTransfer: DataTransfer,
  rootStore: RootStore,
): LibraryBatch | undefined {
  const { tagStore, collectionStore, locationStore, fileStore } = rootStore;
  return runInAction(() => {
    const tag = tagStore.get(dataTransfer.getData(DnDTagType));
    if (tag !== undefined) {
      return { label: tag.name, criteria: [new ClientTagSearchCriteria('tags', tag.id)] };
    }
    const collectionId = dataTransfer.getData(COLLECTION_DND_TYPE);
    const collection = collectionStore.collectionList.find((c) => c.id === collectionId);
    if (collection !== undefined) {
      return {
        label: collection.name,
        criteria: collection.tags.map((t) => new ClientTagSearchCriteria('tags', t.id)),
        matchAny: true,
      };
    }
    const location = locationStore.get(dataTransfer.getData(DnDLocationType));
    if (location !== undefined) {
      return { label: location.name, criteria: [folderCriteria(location.path)] };
    }
    const folder = dataTransfer.getData(DnDFolderType);
    if (folder !== '') {
      return { label: SysPath.basename(folder), criteria: [folderCriteria(folder)] };
    }
    // Images of the gallery: the files dropped that are in the Library, in the order of the gallery
    const paths = new Set(Array.from(dataTransfer.files, (file) => file.path));
    if (paths.size === 0) {
      return undefined;
    }
    const images = fileStore.fileList
      .slice()
      .filter((file) => paths.has(file.absolutePath))
      .map((file) => ({ fileId: file.id, width: file.width, height: file.height }));
    return images.length > 0 ? { label: fileStore.viewName, images } : undefined;
  });
}
