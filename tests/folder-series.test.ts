import {
  FolderDateOrder,
  addToFolderDate,
  dateFolderNames,
  detectFolderSeries,
  folderSeriesNames,
  invalidFolderNameReason,
} from '../common/folder-series';

describe('detectFolderSeries', () => {
  it('continues an existing series', () => {
    expect(detectFolderSeries(['S1', 'S2', 'S3', 'S4'])).toEqual({
      prefix: 'S',
      suffix: '',
      next: 5,
      digits: 0,
      size: 4,
      last: 'S4',
    });
  });

  it('continues folders numbered in front of titles that all differ', () => {
    const series = detectFolderSeries([
      '001 Beach',
      '002 Park',
      '006 Games',
      '006 Wallpapers',
      '016 05012023 Release',
      '016 05012024 Release',
      '017 Pier',
      '126 Harbour',
    ]);
    // Not the pair that only shares "016 … Release": the number in front, after the highest
    expect(series).toMatchObject({
      prefix: '',
      suffix: '',
      next: 127,
      digits: 3,
      last: '126 Harbour',
    });
    expect(folderSeriesNames(series!.prefix, series!.next, series!.digits, '', 1)).toEqual(['127']);
  });

  it('keeps a series with the same text around the number before one of leading numbers', () => {
    // As many folders follow "2024 Roll n" as "2024 + any title": the exact pattern wins
    expect(detectFolderSeries(['2024 Roll 1', '2024 Roll 2', '2024 Roll 3'])).toMatchObject({
      prefix: '2024 Roll ',
      next: 4,
    });
  });

  it('finds nothing without numbered folders', () => {
    expect(detectFolderSeries([])).toBeUndefined();
    expect(detectFolderSeries(['Edits', 'Exports'])).toBeUndefined();
  });

  it('continues after the highest number, not the amount of folders', () => {
    expect(detectFolderSeries(['S1', 'S2', 'S7'])?.next).toBe(8);
    // Sorted as text, S10 comes before S9
    expect(detectFolderSeries(['S1', 'S10', 'S9'])?.next).toBe(11);
  });

  it('keeps leading zeros', () => {
    const series = detectFolderSeries(['Roll_008', 'Roll_009']);
    expect(series).toMatchObject({ prefix: 'Roll_', next: 10, digits: 3 });
    expect(folderSeriesNames(series!.prefix, series!.next, series!.digits, '', 2)).toEqual([
      'Roll_010',
      'Roll_011',
    ]);
  });

  it('detects a suffix', () => {
    expect(detectFolderSeries(['1_scans', '2_scans'])).toMatchObject({
      prefix: '',
      suffix: '_scans',
      next: 3,
    });
  });

  it('counts with the last number in the name', () => {
    expect(detectFolderSeries(['2024 Roll 1', '2024 Roll 2'])).toMatchObject({
      prefix: '2024 Roll ',
      next: 3,
    });
  });

  it('picks the pattern most folders follow', () => {
    expect(
      detectFolderSeries(['S1', 'S2', 'S3', 'Backup 2019', 'Edits', 'T1', 't2']),
    ).toMatchObject({ prefix: 'S', next: 4, size: 3 });
  });

  it('ignores numbers too long to count with', () => {
    expect(detectFolderSeries(['12345678901234567890'])).toBeUndefined();
  });
});

describe('folderSeriesNames', () => {
  it('builds prefix + number + suffix', () => {
    expect(folderSeriesNames('S', 5, 0, '', 3)).toEqual(['S5', 'S6', 'S7']);
    expect(folderSeriesNames('a', 9, 2, 'z', 2)).toEqual(['a09z', 'a10z']);
  });
});

describe('dateFolderNames', () => {
  const base = {
    name: 'Shoot',
    datePosition: 'before' as const,
    order: 'YMD' as const,
    dateSeparator: '-',
    nameSeparator: '_',
    start: { year: 2026, month: 10, day: 30 },
    step: 'day' as const,
    count: 3,
  };

  it('puts the date before or after the name', () => {
    expect(dateFolderNames(base)).toEqual([
      '2026-10-30_Shoot',
      '2026-10-31_Shoot',
      '2026-11-01_Shoot',
    ]);
    expect(dateFolderNames({ ...base, datePosition: 'after', count: 1 })).toEqual([
      'Shoot_2026-10-30',
    ]);
  });

  it('uses only the date without a name', () => {
    expect(dateFolderNames({ ...base, name: '', count: 1 })).toEqual(['2026-10-30']);
  });

  it('supports the date styles and separators', () => {
    const one = (order: FolderDateOrder, dateSeparator: string) =>
      dateFolderNames({ ...base, name: '', order, dateSeparator, count: 1 })[0];
    expect(one('YMD', '')).toBe('20261030');
    expect(one('yMD', '')).toBe('261030');
    expect(one('DMY', '.')).toBe('30.10.2026');
    expect(one('MDY', '_')).toBe('10_30_2026');
    expect(one('YM', '-')).toBe('2026-10');
  });

  it('steps by week and by month, across years and short months', () => {
    expect(dateFolderNames({ ...base, name: '', step: 'week', count: 2 })).toEqual([
      '2026-10-30',
      '2026-11-06',
    ]);
    expect(
      dateFolderNames({
        ...base,
        name: '',
        start: { year: 2026, month: 12, day: 31 },
        step: 'month',
        count: 3,
      }),
    ).toEqual(['2026-12-31', '2027-01-31', '2027-02-28']);
    expect(addToFolderDate({ year: 2026, month: 3, day: 28 }, 'day', 2)).toEqual({
      year: 2026,
      month: 3,
      day: 30,
    });
  });
});

describe('invalidFolderNameReason', () => {
  it('accepts normal names', () => {
    expect(invalidFolderNameReason('S5')).toBeUndefined();
    expect(invalidFolderNameReason('2024 Roll 3 (scans)')).toBeUndefined();
  });

  it('rejects names the file system would refuse or read as a path', () => {
    for (const name of ['', 'a/b', 'a\\b', '..\\S1', 'S:1', 'S1.', ' S1', 'S1 ', 'NUL', 'com1']) {
      expect(invalidFolderNameReason(name)).toBeDefined();
    }
  });
});
