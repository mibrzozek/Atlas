import { action, observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { sortedByName } from 'common/collections';
import { Button, IconButton, IconSet, Tag } from 'widgets';
import { Alert, Dialog, DialogButton } from 'widgets/popovers';
import { ROOT_TAG_ID } from '../../api/tag';
import { TagRemoval } from '../components/RemovalAlert';
import { useStore } from '../contexts/StoreContext';
import { DnDAttribute, TagDnDProvider, useTagDnD } from '../contexts/TagDnDContext';
import { ClientTag } from '../entities/Tag';
import { ClientCollection } from '../stores/CollectionStore';
import { TagMerge } from './Outliner/TagsPanel/TagMerge';
import useLocalStorage from '../hooks/useLocalStorage';
import TagManagerTree, { TagManagerSort } from './TagManagerTree';

/** A text field that changes the name when it is left or Enter is pressed. Escape puts the old name back */
const NameField = ({
  name,
  onRename,
  label,
  autoFocus,
}: {
  name: string;
  onRename: (name: string) => void;
  label: string;
  autoFocus?: boolean;
}) => {
  const [text, setText] = useState(name);
  // Renamed somewhere else, or put back
  useEffect(() => setText(name), [name]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setText(name);
    } else if (trimmed !== name) {
      onRename(trimmed);
    }
  };

  return (
    <input
      className="input tag-manager-name"
      type="text"
      aria-label={label}
      value={text}
      autoFocus={autoFocus}
      onFocus={autoFocus ? (e) => e.target.select() : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          // Not the dialog: only this change
          e.preventDefault();
          e.stopPropagation();
          setText(name);
        }
      }}
    />
  );
};

/** A list to pick one more thing from; it goes back to its placeholder after every pick */
const AddPicker = <T extends { id: string }>({
  placeholder,
  options,
  labelOf,
  onPick,
}: {
  placeholder: string;
  options: T[];
  labelOf: (option: T) => string;
  onPick: (option: T) => void;
}) => (
  <select
    className="tag-manager-add"
    value=""
    disabled={options.length === 0}
    aria-label={placeholder}
    onChange={(e) => {
      const option = options.find((o) => o.id === e.target.value);
      if (option !== undefined) {
        onPick(option);
      }
    }}
  >
    <option value="">{placeholder}</option>
    {options.map((option) => (
      <option key={option.id} value={option.id}>
        {labelOf(option)}
      </option>
    ))}
  </select>
);

const tagPath = (tag: ClientTag) => tag.path.join(' › ');

/**
 * A row of tags that takes up one line. When they do not fit on it, a button at the end shows them all,
 * on as many lines as it takes, and brings it back to one line.
 */
const CollapsibleChips = ({ count, children }: { count: number; children: React.ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsMoreLines, setNeedsMoreLines] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    // More than one line when a tag starts lower than the first one: true whether it is expanded or not
    const measure = () => {
      const [first, ...others] = Array.from(element.children) as HTMLElement[];
      setNeedsMoreLines(
        first !== undefined && others.some((child) => child.offsetTop > first.offsetTop + 4),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);

  return (
    <div className="tag-manager-chips-row">
      <div ref={ref} className="tag-manager-chips" data-collapsed={!isExpanded}>
        {children}
      </div>
      {needsMoreLines && (
        <IconButton
          icon={isExpanded ? IconSet.ARROW_UP : IconSet.ARROW_DOWN}
          className="tag-manager-expand"
          text={isExpanded ? 'Show one line of tags' : `Show all ${count} tags`}
          onClick={() => setIsExpanded(!isExpanded)}
        />
      )}
    </div>
  );
};

interface CollectionCardProps {
  collection: ClientCollection;
  /** All tags, in the order they are offered */
  allTags: ClientTag[];
  isNew: boolean;
  onDelete: (collection: ClientCollection) => void;
}

const CollectionCard = observer(({ collection, allTags, isNew, onDelete }: CollectionCardProps) => {
  const { collectionStore, uiStore } = useStore();
  const tagDnD = useTagDnD();
  const tags = collectionStore.getTags(collection);
  const available = allTags.filter((tag) => !collection.tagIds.includes(tag.id));
  const [isDropTarget, setIsDropTarget] = useState(false);
  // For the plus button: the selected tags that are not in this collection yet
  const numSelected = uiStore.tagSelection.size;
  const numToAdd = Array.from(uiStore.tagSelection).filter(
    (tag) => !collection.tagIds.includes(tag.id),
  ).length;

  return (
    <li
      className="tag-manager-card"
      data-drop-target={isDropTarget || undefined}
      onDragOver={(event) => {
        if (tagDnD.source !== undefined) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'link';
          setIsDropTarget(true);
        }
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={action((event: React.DragEvent) => {
        event.preventDefault();
        setIsDropTarget(false);
        const tag = tagDnD.source;
        if (tag !== undefined) {
          // All selected tags when the dragged one is part of the selection
          const dropped = tag.isSelected ? Array.from(uiStore.tagSelection) : [tag];
          dropped.forEach((t) => collectionStore.addTag(collection, t));
        }
      })}
    >
      <div className="tag-manager-row">
        <span className="tag-manager-icon">{IconSet.TAG_GROUP}</span>
        <NameField
          name={collection.name}
          onRename={(name) => collectionStore.rename(collection, name)}
          label="Name of the collection"
          autoFocus={isNew}
        />
        <IconButton
          icon={IconSet.PLUS}
          className="tag-manager-add-selection"
          text={
            numSelected === 0
              ? 'Select tags on the right, then click here to add them to this collection'
              : numToAdd === 0
              ? 'The selected tags are already in this collection'
              : `Add the ${
                  numToAdd === 1 ? 'selected tag' : `${numToAdd} selected tags`
                } to this collection`
          }
          disabled={numToAdd === 0}
          // A tag that is already in it is skipped
          onClick={action(() =>
            uiStore.tagSelection.forEach((tag) => collectionStore.addTag(collection, tag)),
          )}
        />
        <IconButton
          icon={IconSet.DELETE}
          text="Delete this collection"
          onClick={() => onDelete(collection)}
        />
      </div>
      <CollapsibleChips count={tags.length}>
        {/* In front, so that it is there too while only one line of tags is shown */}
        <AddPicker
          placeholder={tags.length === 0 ? 'Add a tag to this collection...' : 'Add a tag...'}
          options={available}
          labelOf={tagPath}
          onPick={(tag) => collectionStore.addTag(collection, tag)}
        />
        {tags.map((tag) => (
          <Tag
            key={tag.id}
            text={tag.name}
            color={tag.viewColor}
            tooltip={tagPath(tag)}
            onRemove={() => collectionStore.removeTag(collection, tag)}
          />
        ))}
      </CollapsibleChips>
    </li>
  );
});

interface SelectionBarProps {
  onRename: (tag: ClientTag) => void;
  onDelete: (tag: ClientTag) => void;
  onMerge: (tag: ClientTag) => void;
}

/** What can be done with the tags that are selected in the tree */
const SelectionBar = observer(({ onRename, onDelete, onMerge }: SelectionBarProps) => {
  const { collectionStore, tagStore, uiStore } = useStore();
  const tags = Array.from(uiStore.tagSelection);

  if (tags.length === 0) {
    return (
      <div className="tag-manager-selection">
        <span className="tag-manager-hint">
          Click a tag to select it; Ctrl and Shift select several. Drag tags to put them in order,
          onto another tag to put them inside it, or onto a collection. Double-click to rename.
        </span>
      </div>
    );
  }

  const [first] = tags;
  const hasColor = first.color !== '' && first.color !== 'inherit';
  const allHidden = tags.every((tag) => tag.isHidden);
  const canMerge = tags.every((tag) => tag.subTags.length === 0);
  const canMoveOut = tags.some((tag) => tag.parent !== tagStore.root);
  // The collections any of them is in, and the ones not all of them are in
  const memberships = collectionStore.sortedByName.filter((collection) =>
    tags.some((tag) => collection.tagIds.includes(tag.id)),
  );
  const joinable = collectionStore.sortedByName.filter(
    (collection) => !tags.every((tag) => collection.tagIds.includes(tag.id)),
  );

  const setColor = action((color: string) => tags.forEach((tag) => tag.setColor(color)));
  const setHidden = action((isHidden: boolean) =>
    tags.forEach((tag) => tag.isHidden !== isHidden && tag.toggleHidden()),
  );

  return (
    <div className="tag-manager-selection">
      <div className="tag-manager-row">
        <span className="tag-manager-selection-title">
          {tags.length === 1 ? first.name : `${tags.length} tags selected`}
        </span>
        <input
          type="color"
          className="tag-manager-color"
          data-empty={!hasColor}
          aria-label="Color"
          title={hasColor ? 'Change the color' : 'Give a color'}
          value={hasColor ? first.color : '#808080'}
          onChange={(e) => setColor(e.target.value)}
        />
        {tags.some((tag) => tag.color !== '') && (
          <IconButton icon={IconSet.COLOR} text="Remove the color" onClick={() => setColor('')} />
        )}
        <IconButton
          icon={IconSet.EDIT}
          text={tags.length === 1 ? 'Rename' : 'Select one tag to rename it'}
          disabled={tags.length !== 1}
          onClick={() => onRename(first)}
        />
        <IconButton
          icon={allHidden ? IconSet.HIDDEN : IconSet.PREVIEW}
          text={
            allHidden
              ? 'Their images are hidden. Click to show them'
              : 'Their images are shown. Click to hide them'
          }
          onClick={() => setHidden(!allHidden)}
        />
        <IconButton
          icon={IconSet.ARROW_LEFT}
          text="Take out of the tag it is inside"
          disabled={!canMoveOut}
          onClick={() => uiStore.moveSelectedTagItems(ROOT_TAG_ID, tagStore.root.subTags.length)}
        />
        <IconButton
          icon={IconSet.TAG_GROUP}
          text={
            canMerge ? 'Merge into another tag...' : 'A tag with tags inside it cannot be merged'
          }
          disabled={!canMerge}
          onClick={() => onMerge(first)}
        />
        <IconButton icon={IconSet.DELETE} text="Delete" onClick={() => onDelete(first)} />
        <IconButton
          icon={IconSet.CLOSE}
          text="Select nothing"
          onClick={uiStore.clearTagSelection}
        />
      </div>
      <div className="tag-manager-chips">
        {memberships.map((collection) => (
          <Tag
            key={collection.id}
            text={collection.name}
            tooltip="Collection"
            onRemove={() => tags.forEach((tag) => collectionStore.removeTag(collection, tag))}
          />
        ))}
        <AddPicker
          placeholder="Add to a collection..."
          options={joinable}
          labelOf={(collection) => collection.name}
          onPick={(collection) => tags.forEach((tag) => collectionStore.addTag(collection, tag))}
        />
      </div>
    </div>
  );
});

const TagManagerContent = observer(() => {
  const { collectionStore, tagStore, uiStore } = useStore();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useLocalStorage<TagManagerSort>('tag-manager-sort', 'hierarchy');
  const [onlyLoose, setOnlyLoose] = useState(false);
  // What was just made: its name is selected, ready to be typed over
  const [newId, setNewId] = useState<string>();
  const [deletableTag, setDeletableTag] = useState<ClientTag>();
  const [mergableTag, setMergableTag] = useState<ClientTag>();
  const [deletableCollection, setDeletableCollection] = useState<ClientCollection>();

  // Alphabetical by their whole path, so sub-tags follow the tag they are in
  const tagList = tagStore.tagList;
  const allTags = useMemo(
    () =>
      runInAction(() =>
        sortedByName(tagList.map((tag) => ({ tag, name: tag.path.join(' › ') }))).map(
          (entry) => entry.tag,
        ),
      ),
    // The names are part of it: a renamed tag moves to its new place when the list is next built
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagList, tagList.map((tag) => tag.name).join('\n')],
  );
  const collections = collectionStore.sortedByName;

  const query = filter.trim().toLowerCase();
  const matches = (name: string) => query.length === 0 || name.toLowerCase().includes(query);
  const shownCollections = collections.filter(
    (collection) =>
      collection.id === newId ||
      matches(collection.name) ||
      collectionStore.getTags(collection).some((tag) => matches(tag.name)),
  );

  // The tag whose name is being typed in the tree
  const [editableTagId, setEditableTagId] = useState<string>();
  const handleNewTag = () =>
    tagStore
      .create(tagStore.root, 'New tag')
      .then((tag) => {
        uiStore.selectTag(tag, true);
        setEditableTagId(tag.id);
      })
      .catch((err) => console.error('Could not create tag', err));

  // What is being dragged in here: the gallery and the side panel have a holder of their own
  const dnd = useRef(observable({ source: undefined, target: undefined }));
  useEffect(() => {
    const handleDragEnd = action((event: DragEvent) => {
      dnd.current.source = undefined;
      if (event.target instanceof HTMLElement) {
        event.target.dataset[DnDAttribute.Source] = 'false';
      }
    });
    window.addEventListener('dragend', handleDragEnd, true);
    return () => window.removeEventListener('dragend', handleDragEnd, true);
  }, []);

  const handleNewCollection = () =>
    collectionStore
      .create()
      .then((collection) => setNewId(collection.id))
      .catch((err) => console.error('Could not create collection', err));

  return (
    <TagDnDProvider value={dnd.current}>
      <div id="tag-manager">
        <div className="tag-manager-toolbar">
          <input
            className="input"
            type="search"
            placeholder="Find a tag or collection"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="tag-manager-columns">
          <section>
            <header>
              <h3>
                Collections <small>{collections.length}</small>
              </h3>
              <Button
                styling="outlined"
                icon={IconSet.PLUS}
                text="New collection"
                onClick={handleNewCollection}
              />
            </header>
            {shownCollections.length === 0 ? (
              <p className="tag-manager-empty">
                {collections.length === 0
                  ? 'A collection is a group of tags. Clicking it in the side panel shows the images of all its tags together.'
                  : 'No collection matches.'}
              </p>
            ) : (
              <ul>
                {shownCollections.map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    allTags={allTags}
                    isNew={collection.id === newId}
                    onDelete={setDeletableCollection}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <header>
              <h3>
                Tags <small>{allTags.length}</small>
              </h3>
              <label
                className="tag-manager-option"
                data-tooltip="Only the tags that are in no collection"
              >
                <input
                  type="checkbox"
                  checked={onlyLoose}
                  onChange={() => setOnlyLoose(!onlyLoose)}
                />
                Not in a collection
              </label>
              <select
                className="tag-manager-sort"
                aria-label="Sort the tags"
                value={sort}
                onChange={(e) => setSort(e.target.value as TagManagerSort)}
              >
                <option value="hierarchy">By hierarchy</option>
                <option value="name">Alphabetically</option>
                <option value="date">By date created</option>
              </select>
              <Button
                styling="outlined"
                icon={IconSet.PLUS}
                text="New tag"
                onClick={handleNewTag}
              />
            </header>
            <SelectionBar
              onRename={(tag) => setEditableTagId(tag.id)}
              onDelete={setDeletableTag}
              onMerge={setMergableTag}
            />
            <TagManagerTree
              query={query}
              sort={sort}
              onlyLoose={onlyLoose}
              editableId={editableTagId}
              setEditableId={setEditableTagId}
            />
          </section>
        </div>

        {deletableTag && (
          <TagRemoval object={deletableTag} onClose={() => setDeletableTag(undefined)} />
        )}
        {mergableTag && <TagMerge tag={mergableTag} onClose={() => setMergableTag(undefined)} />}
        {deletableCollection && (
          <Alert
            open
            title={`Are you sure you want to delete the collection "${deletableCollection.name}"?`}
            icon={IconSet.WARNING}
            type="danger"
            primaryButtonText="Delete"
            defaultButton={DialogButton.PrimaryButton}
            onClick={(button) => {
              if (button !== DialogButton.CloseButton) {
                collectionStore.remove(deletableCollection).catch(console.error);
              }
              setDeletableCollection(undefined);
            }}
          >
            <p>Its tags, and the images that have them, stay as they are.</p>
          </Alert>
        )}
      </div>
    </TagDnDProvider>
  );
});

/**
 * The page where all tags and collections are listed and changed: names, colors, which tag is inside which,
 * which tags make up a collection, merging and deleting. The side panel only shows and opens them.
 */
const TagManager = observer(() => {
  const { uiStore } = useStore();
  return (
    <Dialog
      open={uiStore.isTagManagerOpen}
      title="Tags and Collections"
      icon={IconSet.TAG_GROUP}
      onCancel={uiStore.closeTagManager}
      isMovable
    >
      {uiStore.isTagManagerOpen && <TagManagerContent />}
    </Dialog>
  );
});

export default TagManager;
