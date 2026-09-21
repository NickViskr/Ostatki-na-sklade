/** Item 78a/b: the shape `getTurnoverData` in Code.gs answers with. */
import { KanDayRow, SnapshotRow } from './turnover';

export interface TurnoverData {
  days: number;
  cutoff: string;
  latestKanDay: string;
  kanRows: KanDayRow[];
  snapshots: SnapshotRow[];
}
