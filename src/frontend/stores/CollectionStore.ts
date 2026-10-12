import { action, computed, makeObservable, observable, runInAction } from 'mobx';

import {
  collectionFromRow,
  collectionToRow,
  moveItem,
  sortedByName,
  uniqueName,
} from 'common/collections';
import { DataStorage } from '../../api/data-storage';
import { FileSearchDTO } from '../../api/file-search';
import { ID, generateId } from '../../api/id';
import { AppToaster } from '../components/Toaster';
import { ClientTagSearchCriteria } from '../entities/SearchCriteria';
import { ClientTag } from '../entities/Tag';
import RootStore from './RootStore';

/** A named group of tags. A tag can be in any number of collections */
export class ClientCollection {
  readonly id: ID;
  @observable name: string;
  /** Its place in the list when sorted by hand */
  @observable index: number;
  readonly tagIds = observable<ID>([]);

  constructor(id: ID, name: string, tagIds: ID[], index: number) {
    this.id = id;
    this.name = name;
    this.index = index;
    this.tagIds.replace(tagIds);
    makeObservable(this);
  }
}

/**
 * The collections of tags. They are stored in the table of saved searches (see common/collections.ts),
 * and written whenever they are changed.
 */
class CollectionStore {
  private readonly backend: DataStorage;
  private readonly rootStore: RootStore;

  /** In the order they are sorted by hand */
  readonly collectionList = observable<ClientCollection>([]);

  constructor(backend: DataStorage, rootStore: RootStore) {
    this.backend = backend;
    this.rootStore = rootStore;
    makeObservable(this);
  }

  async init(): Promise<void> {
    try {
      const rows = await this.backend.fetchSearches();
      const collections = rows
        .map(collectionFromRow)
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .sort((a, b) => a.index - b.index)
        .map((c, i) => new ClientCollection(c.id, c.name, c.tagIds, i));
      runInAction(() => this.collectionList.replace(collections));
    } catch (err) {
      console.error('Could not load collections', err);
    }
  }

  @computed get sortedByName(): ClientCollection[] {
    return sortedByName(this.collectionList);
  }

  // The three below are read while rendering. They are not actions on purpose: inside an action
  // nothing is tracked, and the panels would not follow changes to a collection

  /** The tags of the collection that still exist */
  getTags = (collection: ClientCollection): ClientTag[] => {
    const { tagStore } = this.rootStore;
    const tags: ClientTag[] = [];
    for (const id of collection.tagIds) {
      const tag = tagStore.get(id);
      if (tag !== undefined) {
        tags.push(tag);
      }
    }
    return tags;
  };

  getCollectionsOf = (tag: ClientTag): ClientCollection[] =>
    this.collectionList.filter((c) => c.tagIds.includes(tag.id));

  /** Whether the gallery is showing exactly the images of this collection */
  isViewed = (collection: ClientCollection): boolean => {
    const { uiStore, fileStore } = this.rootStore;
    const tags = this.getTags(collection);
    const crits = uiStore.searchCriteriaList;
    return (
      tags.length > 0 &&
      fileStore.showsQueryContent &&
      crits.length === tags.length &&
      (tags.length === 1 || uiStore.searchMatchAny) &&
      crits.every(
        (crit) =>
          crit instanceof ClientTagSearchCriteria &&
          crit.value !== undefined &&
          collection.tagIds.includes(crit.value),
      )
    );
  };

  /** Shows the images that have any of the tags of the collection */
  @action.bound view(collection: ClientCollection): void {
    const { uiStore } = this.rootStore;
    const tags = this.getTags(collection);
    if (tags.length === 0) {
      AppToaster.show(
        {
          message: `"${collection.name}" has no tags yet`,
          timeout: 5000,
          clickAction: { label: 'Add tags', onClick: uiStore.openTagManager },
        },
        'empty-collection',
      );
      return;
    }
    // Before the search is replaced: that is what loads the images
    uiStore.searchMatchAny = true;
    uiStore.replaceSearchCriterias(tags.map((tag) => new ClientTagSearchCriteria('tags', tag.id)));
  }

  @action.bound async create(name?: string): Promise<ClientCollection> {
    const collection = new ClientCollection(
      generateId(),
      name ??
        uniqueName(
          'New collection',
          this.collectionList.map((c) => c.name),
        ),
      [],
      this.collectionList.length,
    );
    this.collectionList.push(collection);
    await this.backend.createSearch(this.serialize(collection));
    return collection;
  }

  @action.bound async remove(collection: ClientCollection): Promise<void> {
    this.collectionList.remove(collection);
    this.updateIndices();
    await this.backend.removeSearch(collection.id);
  }

  @action.bound rename(collection: ClientCollection, name: string): void {
    const trimmed = name.trim();
    if (trimmed.length > 0 && trimmed !== collection.name) {
      collection.name = trimmed;
      this.save(collection);
    }
  }

  @action.bound addTag(collection: ClientCollection, tag: ClientTag): void {
    if (!collection.tagIds.includes(tag.id)) {
      collection.tagIds.push(tag.id);
      this.save(collection);
    }
  }

  @action.bound removeTag(collection: ClientCollection, tag: ClientTag): void {
    if (collection.tagIds.remove(tag.id)) {
      this.save(collection);
    }
  }

  /** Moves the collection to the given position of the hand-sorted list */
  @action.bound move(collection: ClientCollection, toIndex: number): void {
    const from = this.collectionList.indexOf(collection);
    if (from === -1) {
      return;
    }
    this.collectionList.replace(moveItem(this.collectionList, from, toIndex));
    this.updateIndices();
  }

  /** Stores the position of every collection whose position changed */
  @action private updateIndices(): void {
    this.collectionList.forEach((collection, i) => {
      if (collection.index !== i) {
        collection.index = i;
        this.save(collection);
      }
    });
  }

  private serialize(collection: ClientCollection): FileSearchDTO {
    return collectionToRow({
      id: collection.id,
      name: collection.name,
      // Tags that were deleted are dropped the next time it is stored
      tagIds: this.getTags(collection).map((tag) => tag.id),
      index: collection.index,
    }) as unknown as FileSearchDTO;
  }

  private save(collection: ClientCollection): void {
    this.backend.saveSearch(this.serialize(collection)).catch(console.error);
  }
}

export default CollectionStore;
