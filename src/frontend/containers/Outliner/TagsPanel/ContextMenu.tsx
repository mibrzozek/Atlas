import { observer } from 'mobx-react-lite';
import React from 'react';

import { IconSet } from 'widgets';
import { Menu, MenuDivider, MenuItem } from 'widgets/menus';
import { useStore } from '../../../contexts/StoreContext';
import { ClientTagSearchCriteria } from '../../../entities/SearchCriteria';
import { ClientTag } from '../../../entities/Tag';

interface IContextMenuProps {
  tag: ClientTag;
  pos: number;
  /** Moving up and down only means something while the tags are sorted by hand */
  isManualSort: boolean;
}

export const TagItemContextMenu = observer((props: IContextMenuProps) => {
  const { tag, pos, isManualSort } = props;
  const { uiStore, fileStore } = useStore();
  const ctxTags = uiStore.getTagContextItems(tag.id);

  return (
    <Menu>
      <MenuItem
        onClick={() =>
          tag.isSelected
            ? uiStore.addTagSelectionToCriteria()
            : uiStore.addSearchCriteria(new ClientTagSearchCriteria('tags', tag.id))
        }
        text="Add to Search"
        icon={IconSet.SEARCH}
      />
      <MenuItem
        onClick={() =>
          tag.isSelected
            ? uiStore.replaceCriteriaWithTagSelection()
            : uiStore.replaceSearchCriteria(new ClientTagSearchCriteria('tags', tag.id))
        }
        text="Replace Search"
        icon={IconSet.REPLACE}
      />
      <MenuItem
        onClick={() => uiStore.openTagInspector(tag)}
        text="Inspect..."
        icon={IconSet.INFO}
      />
      <MenuItem
        onClick={() => fileStore.exportTaggedFilesToFolder(ctxTags)}
        text="Export Tagged Images to Folder..."
        icon={IconSet.FOLDER_OPEN}
      />
      <MenuDivider />
      <MenuItem
        onClick={() => tag.parent.insertSubTag(tag, pos - 2)}
        text="Move Up"
        icon={IconSet.ITEM_MOVE_UP}
        disabled={!isManualSort || pos === 1}
      />
      <MenuItem
        onClick={() => tag.parent.insertSubTag(tag, pos + 1)}
        text="Move Down"
        icon={IconSet.ITEM_MOVE_DOWN}
        disabled={!isManualSort || pos === tag.parent.subTags.length}
      />
      <MenuDivider />
      <MenuItem
        onClick={uiStore.openTagManager}
        text="Edit Tags and Collections..."
        icon={IconSet.EDIT}
      />
    </Menu>
  );
});
