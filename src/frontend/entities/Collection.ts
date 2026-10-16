import { action, makeObservable, observable } from 'mobx';

import { ID } from '../../api/id';
import { AppToaster } from '../components/Toaster';
import CollectionStore from '../stores/CollectionStore';
import { ClientTagSearchCriteria } from './SearchCriteria';
import { ClientTag } from './Tag';

/**
 * A named group of tags. A tag can be in any number of collections.
 * Every change is stored right away.
 */
export class ClientCollection {
  private readonly store: CollectionStore;

  readonly id: ID;
  @observable name: string;
  /** Its place in the list when sorted by hand */
  @observable index: number;
  readonly tagIds = observable<ID>([]);

  constructor(store: CollectionStore, id: ID, name: string, tagIds: ID[], index: number) {
    this.store = store;
    this.id = id;
    this.name = name;
    this.index = index;
    this.tagIds.replace(tagIds);
    makeObservable(this);
  }

  // The getters below are read while rendering. They are not actions on purpose: inside an action
  // nothing is tracked, and the panels would not follow changes to a collection

  /** Its tags that still exist */
  get tags(): ClientTag[] {
    const { tagStore } = this.store.rootStore;
    const tags: ClientTag[] = [];
    for (const id of this.tagIds) {
      const tag = tagStore.get(id);
      if (tag !== undefined) {
        tags.push(tag);
      }
    }
    return tags;
  }

  has = (tag: ClientTag): boolean => this.tagIds.includes(tag.id);

  /** Whether the gallery is showing exactly the images of this collection */
  get isViewed(): boolean {
    const { uiStore, fileStore } = this.store.rootStore;
    const { tags } = this;
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
          this.tagIds.includes(crit.value),
      )
    );
  }

  /** Shows the images that have any of its tags */
  @action.bound view(): void {
    const { uiStore } = this.store.rootStore;
    const { tags } = this;
    if (tags.length === 0) {
      AppToaster.show(
        {
          message: `"${this.name}" has no tags yet`,
          timeout: 5000,
          clickAction: { label: 'Add tags', onClick: uiStore.openTagManager },
        },
        'empty-collection',
      );
      return;
    }
    uiStore.viewAnyOfTags(tags);
  }

  @action.bound rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length > 0 && trimmed !== this.name) {
      this.name = trimmed;
      this.store.save(this);
    }
  }

  /** A tag that is already in it stays in it once */
  @action.bound add(tag: ClientTag): void {
    if (!this.has(tag)) {
      this.tagIds.push(tag.id);
      this.store.save(this);
    }
  }

  @action.bound remove(tag: ClientTag): void {
    if (this.tagIds.remove(tag.id)) {
      this.store.save(this);
    }
  }

  @action.bound setIndex(index: number): void {
    if (this.index !== index) {
      this.index = index;
      this.store.save(this);
    }
  }
}
