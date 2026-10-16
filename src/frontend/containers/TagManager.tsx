import { action, observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { sortedByName } from 'common/collections';
import { Button, IconButton, IconSet, Tag } from 'widgets';
import { Alert, Dialog, DialogButton } from 'widgets/popovers';
import { ROOT_TAG_ID } from '../../api/tag';
import { TagRemoval } from '../components/RemovalAlert';
import TagColorPicker from '../components/TagColorPicker';
import { useStore } from '../contexts/StoreContext';
import { DnDAttribute, TagDnDProvider } from '../contexts/TagDnDContext';
import { ClientTag } from '../entities/Tag';
import { ClientCollection } from '../entities/Collection';
import { useCollectionDnD } from './Outliner/CollectionsPanel/useCollectionDnD';
import { TagMerge } from './Outliner/TagsPanel/TagMerge';
import useLocalStorage from '../hooks/useLocalStorage';
import TagManagerTree, { TagManagerSort } from './TagManagerTree';

/** A text field that changes the name when it is left or Enter is pressed. Escape puts the old name back */
const NameField = ({
  name,
  onRename,
  label,
  autoFocus,
  onDone,
}: {
  name: string;
  onRename: (name: string) => void;
  label: string;
  autoFocus?: boolean;
  /** When the field is left, whether the name was changed or not */
  onDone?: () => void;
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
      onBlur={() => {
        commit();
        onDone?.();
      }}
      // Typing a name is not a click on what the field is in
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
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

interface CollectionChipProps {
  collection: ClientCollection;
  /** All tags, in the order they are offered */
  allTags: ClientTag[];
  isNew: boolean;
  onDelete: (collection: ClientCollection) => void;
}

/**
 * A collection as a small chip: its name, and a plus that adds the selected tags to it.
 * Clicking it shows what is in it; dragging it puts it somewhere else in the list.
 */
const CollectionChip = observer(({ collection, allTags, isNew, onDelete }: CollectionChipProps) => {
  const { uiStore } = useStore();
  // A new one opens up with its name ready to be typed
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  useEffect(() => {
    if (isNew) {
      setIsExpanded(true);
      setIsRenaming(true);
    }
  }, [isNew]);
  const { target, props: dnd } = useCollectionDnD(collection, !isRenaming);
  const tags = collection.tags;
  // For the plus: the selected tags that are not in this collection yet
  const numSelected = uiStore.tagSelection.size;
  const numToAdd = Array.from(uiStore.tagSelection).filter((tag) => !collection.has(tag)).length;

  return (
    <li className="tag-manager-collection" data-expanded={isExpanded} data-drop-target={target}>
      <div
        className="tag-manager-collection-chip"
        {...dnd}
        onClick={() => setIsExpanded(!isExpanded)}
        onDoubleClick={() => setIsRenaming(true)}
        data-tooltip={
          isExpanded
            ? 'Click to close. Drag to move it. Double-click to rename'
            : `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}. Click to open, drag to move it`
        }
      >
        {isRenaming ? (
          <NameField
            name={collection.name}
            onRename={collection.rename}
            label="Name of the collection"
            autoFocus
            onDone={() => setIsRenaming(false)}
          />
        ) : (
          <span className="tag-manager-collection-name">{collection.name}</span>
        )}
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
          onClick={action((event: React.MouseEvent) => {
            event.stopPropagation();
            uiStore.tagSelection.forEach(collection.add);
          })}
        />
      </div>
      {isExpanded && (
        <div className="tag-manager-collection-body">
          <div className="tag-manager-chips">
            {tags.map((tag) => (
              <Tag
                key={tag.id}
                text={tag.name}
                color={tag.viewColor}
                tooltip={tagPath(tag)}
                onRemove={() => collection.remove(tag)}
              />
            ))}
            <AddPicker
              placeholder={tags.length === 0 ? 'Add a tag to this collection...' : 'Add a tag...'}
              options={allTags.filter((tag) => !collection.has(tag))}
              labelOf={tagPath}
              onPick={collection.add}
            />
          </div>
          <div className="tag-manager-collection-actions">
            <IconButton icon={IconSet.EDIT} text="Rename" onClick={() => setIsRenaming(true)} />
            <IconButton
              icon={IconSet.DELETE}
              text="Delete this collection. Its tags stay"
              onClick={() => onDelete(collection)}
            />
          </div>
        </div>
      )}
    </li>
  );
});

interface SelectionBarProps {
  /** Tags can only be moved up and down where they are listed in the order they are kept in */
  canReorder: boolean;
  onRename: (tag: ClientTag) => void;
  onDelete: (tag: ClientTag) => void;
  onMerge: (tag: ClientTag) => void;
}

/** What can be done with the tags that are selected in the tree */
const SelectionBar = observer(({ canReorder, onRename, onDelete, onMerge }: SelectionBarProps) => {
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
  const isOne = tags.length === 1;
  const siblings = first.parent.subTags;
  const position = siblings.indexOf(first);
  const allHidden = tags.every((tag) => tag.isHidden);
  const canMerge = tags.every((tag) => tag.subTags.length === 0);
  const isInsideAnother = tags.some((tag) => tag.parent !== tagStore.root);
  // The collections any of them is in, and the ones not all of them are in
  const memberships = collectionStore.sortedByName.filter((collection) =>
    tags.some(collection.has),
  );
  const joinable = collectionStore.sortedByName.filter((collection) => !tags.every(collection.has));

  const setColor = action((color: string) => tags.forEach((tag) => tag.setColor(color)));
  const setHidden = action((isHidden: boolean) =>
    tags.forEach((tag) => tag.isHidden !== isHidden && tag.toggleHidden()),
  );
  // `insertSubTag` takes the place the tag has before it is taken out of the list
  const moveUp = () => first.parent.insertSubTag(first, position - 1);
  const moveDown = () => first.parent.insertSubTag(first, position + 2);
  const whyNotMove = !canReorder
    ? 'Sort the tags by hierarchy to move them'
    : !isOne
    ? 'Select one tag to move it'
    : undefined;

  return (
    <div className="tag-manager-selection">
      <div className="tag-manager-row">
        <span className="tag-manager-selection-title">
          {isOne ? first.name : `${tags.length} tags selected`}
        </span>
        <IconButton
          icon={IconSet.EDIT}
          text={isOne ? 'Rename' : 'Select one tag to rename it'}
          disabled={!isOne}
          onClick={() => onRename(first)}
        />
        <IconButton
          icon={IconSet.ARROW_UP}
          text={whyNotMove ?? 'Move up'}
          disabled={whyNotMove !== undefined || position <= 0}
          onClick={moveUp}
        />
        <IconButton
          icon={IconSet.ARROW_DOWN}
          text={whyNotMove ?? 'Move down'}
          disabled={whyNotMove !== undefined || position >= siblings.length - 1}
          onClick={moveDown}
        />
        {/* Only there when there is something to take it out of */}
        {isInsideAnother && (
          <IconButton
            icon={IconSet.ARROW_LEFT}
            text={
              isOne
                ? `Take it out of ${first.parent.name}, to the top level`
                : 'Take them out of the tags they are inside, to the top level'
            }
            onClick={() => uiStore.moveSelectedTagItems(ROOT_TAG_ID, tagStore.root.subTags.length)}
          />
        )}
        <IconButton
          icon={allHidden ? IconSet.HIDDEN : IconSet.PREVIEW}
          text={
            allHidden
              ? 'Images with this tag are hidden everywhere. Click to show them again'
              : 'Images with this tag are shown. Click to hide them everywhere'
          }
          onClick={() => setHidden(!allHidden)}
        />
        <IconButton
          icon={IconSet.TAG_GROUP}
          text={
            canMerge
              ? 'Merge: pick another tag, the images of this one get that tag, and this one is removed'
              : 'A tag with tags inside it cannot be merged: take those out first'
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
      <TagColorPicker color={first.color === 'inherit' ? '' : first.color} onPick={setColor} />
      <div className="tag-manager-chips">
        {memberships.map((collection) => (
          <Tag
            key={collection.id}
            text={collection.name}
            tooltip="Collection"
            onRemove={() => tags.forEach(collection.remove)}
          />
        ))}
        <AddPicker
          placeholder="Add to a collection..."
          options={joinable}
          labelOf={(collection) => collection.name}
          onPick={(collection) => tags.forEach(collection.add)}
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
  // In the order they were put in by hand: the same as in the side panel
  const collections = collectionStore.collectionList.slice();

  const query = filter.trim().toLowerCase();
  const matches = (name: string) => query.length === 0 || name.toLowerCase().includes(query);
  const shownCollections = collections.filter(
    (collection) =>
      collection.id === newId ||
      matches(collection.name) ||
      collection.tags.some((tag) => matches(tag.name)),
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
              <ul className="tag-manager-collections">
                {shownCollections.map((collection) => (
                  <CollectionChip
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
              canReorder={sort === 'hierarchy'}
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
