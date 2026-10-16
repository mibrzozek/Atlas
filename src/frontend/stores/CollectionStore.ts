import { action, computed, makeObservable, observable, runInAction } from 'mobx';

import {
  collectionFromRow,
  collectionToRow,
  moveItem,
  sortedByName,
  uniqueName,
} from 'common/collections';
import { DataStorage } from '../../api/data-storage';
import { generateId } from '../../api/id';
import { ClientCollection } from '../entities/Collection';
import { ClientTag } from '../entities/Tag';
import RootStore from './RootStore';

/**
 * The collections of tags. They are stored in the table of saved searches (see common/collections.ts),
 * and written whenever they are changed.
 */
class CollectionStore {
  private readonly backend: DataStorage;
  readonly rootStore: RootStore;

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
        .map((c, i) => new ClientCollection(this, c.id, c.name, c.tagIds, i));
      runInAction(() => this.collectionList.replace(collections));
    } catch (err) {
      console.error('Could not load collections', err);
    }
  }

  @computed get sortedByName(): ClientCollection[] {
    return sortedByName(this.collectionList);
  }

  /** Not an action, so that what renders it follows changes: see ClientCollection */
  collectionsOf = (tag: ClientTag): ClientCollection[] =>
    this.collectionList.filter((collection) => collection.has(tag));

  @action.bound async create(name?: string): Promise<ClientCollection> {
    const collection = new ClientCollection(
      this,
      generateId(),
      name ??
        uniqueName(
          'New collection',
          this.collectionList.map((c) => c.name),
        ),
      [],
      0,
    );
    // On top, where it is seen
    this.collectionList.unshift(collection);
    this.updateIndices();
    await this.backend.createSearch(this.serialize(collection));
    return collection;
  }

  @action.bound async remove(collection: ClientCollection): Promise<void> {
    this.collectionList.remove(collection);
    this.updateIndices();
    await this.backend.removeSearch(collection.id);
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

  /** Moves the collection to right before or after another one */
  @action.bound moveNextTo(
    collection: ClientCollection,
    other: ClientCollection,
    place: 'before' | 'after',
  ): void {
    if (collection === other) {
      return;
    }
    const others = this.collectionList.filter((c) => c !== collection);
    this.move(collection, others.indexOf(other) + (place === 'before' ? 0 : 1));
  }

  save(collection: ClientCollection): void {
    this.backend.saveSearch(this.serialize(collection)).catch(console.error);
  }

  /** Every collection knows its place in the list, and stores it when it changes */
  @action private updateIndices(): void {
    this.collectionList.forEach((collection, i) => collection.setIndex(i));
  }

  private serialize(collection: ClientCollection) {
    return collectionToRow({
      id: collection.id,
      name: collection.name,
      // Tags that were deleted are dropped the next time it is stored
      tagIds: collection.tags.map((tag) => tag.id),
      index: collection.index,
    });
  }
}

export default CollectionStore;
