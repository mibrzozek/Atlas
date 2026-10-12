import { ID } from './id';
import { SearchCriteria } from './search-criteria';

export type FileSearchDTO = {
  id: ID;
  name: string;
  criteria: SearchCriteria[];
  matchAny?: boolean;
  index: number;
  /** Marks a collection of tags, which is kept in this table as well: see common/collections.ts */
  isCollection?: boolean;
};
