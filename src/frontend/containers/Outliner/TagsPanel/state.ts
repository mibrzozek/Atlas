import { ID } from '../../../../api/id';
import { IAction, IExpansionState } from '../../types';

const enum Flag {
  Expansion,
  ToggleNode,
  ExpandNode,
}

export type Action =
  | IAction<Flag.ToggleNode | Flag.ExpandNode, ID>
  | IAction<Flag.Expansion, IExpansionState | ((prevState: IExpansionState) => IExpansionState)>;

export const Factory = {
  setExpansion: (
    data: IExpansionState | ((prevState: IExpansionState) => IExpansionState),
  ): Action => ({
    flag: Flag.Expansion,
    data,
  }),
  toggleNode: (data: ID): Action => ({ flag: Flag.ToggleNode, data }),
  expandNode: (data: ID): Action => ({ flag: Flag.ExpandNode, data }),
};

/** Which tags of the panel are expanded. Tags are changed in the page for editing them, not here */
export type State = {
  expansion: IExpansionState;
};

export function reducer(state: State, action: Action): State {
  switch (action.flag) {
    case Flag.Expansion:
      return {
        expansion: {
          ...(typeof action.data === 'function' ? action.data(state.expansion) : action.data),
        },
      };

    case Flag.ToggleNode:
      return { expansion: { ...state.expansion, [action.data]: !state.expansion[action.data] } };

    case Flag.ExpandNode:
      return { expansion: { ...state.expansion, [action.data]: true } };

    default:
      return state;
  }
}
