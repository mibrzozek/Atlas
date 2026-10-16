import React from 'react';

import { ClientWorkspace } from '../../entities/Workspace';

/**
 * The name of a workspace, being changed in place (its tab, its row in the side panel): Enter or leaving
 * it keeps the new name, Escape the old one
 */
export function WorkspaceNameInput({
  workspace,
  className,
  onDone,
}: {
  workspace: ClientWorkspace;
  className: string;
  onDone: () => void;
}): JSX.Element {
  return (
    <input
      className={className}
      autoFocus
      defaultValue={workspace.name}
      aria-label="Name of the workspace"
      onFocus={(event) => event.target.select()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          workspace.rename(event.currentTarget.value);
          onDone();
        } else if (event.key === 'Escape') {
          onDone();
        }
      }}
      onBlur={(event) => {
        workspace.rename(event.currentTarget.value);
        onDone();
      }}
    />
  );
}
