import { fileNamingFromRow, FileNaming, nextFileName } from '../common/file-naming';

const day = { year: 2026, month: 11, day: 19 };

const pattern = (prefix: string, digits = 3, suffix = ''): FileNaming => ({
  mode: 'pattern',
  prefix,
  digits,
  suffix,
});

const byDate: FileNaming = {
  mode: 'date',
  name: 'Sample',
  datePosition: 'before',
  order: 'YMD',
  dateSeparator: '-',
  nameSeparator: '_',
};

describe('nextFileName by pattern', () => {
  it('starts at 1 in a folder with no files of the pattern', () => {
    expect(nextFileName(pattern('Sample_'), [], day)).toBe('Sample_001');
    expect(nextFileName(pattern('Sample_'), ['Other_005.png', 'notes.txt'], day)).toBe(
      'Sample_001',
    );
  });

  it('goes on from the highest number, whatever the extensions and the order of the names', () => {
    const taken = ['Sample_002.png', 'Sample_001.jpg', 'Sample_009.png', 'Sample_004.jpg'];
    expect(nextFileName(pattern('Sample_'), taken, day)).toBe('Sample_010');
  });

  it('pads the number to the digits of the naming', () => {
    expect(nextFileName(pattern('Sample_', 1), ['Sample_9.png'], day)).toBe('Sample_10');
    expect(nextFileName(pattern('Sample_', 0), [], day)).toBe('Sample_1');
    expect(nextFileName(pattern('Sample_', 3), ['Sample_9.png'], day)).toBe('Sample_010');
  });

  it('counts only names with the same prefix and suffix, and only numbers in between', () => {
    const taken = [
      'Sample_003.png',
      'Sample_020 copy.png',
      'Sample_1_5.png',
      'Other_050.png',
      'Sample_100.png.bak',
      'Sample (2).png',
    ];
    expect(nextFileName(pattern('Sample_'), taken, day)).toBe('Sample_004');
  });

  it('keeps the suffix after the number', () => {
    const taken = ['Roll_007_scan.tif', 'Roll_008_scan.tif', 'Roll_008.tif'];
    expect(nextFileName(pattern('Roll_', 3, '_scan'), taken, day)).toBe('Roll_009_scan');
  });

  it('matches the names case-insensitively, as Windows does', () => {
    expect(nextFileName(pattern('haight_'), ['HAIGHT_004.png'], day)).toBe('haight_005');
  });

  it('makes the name fit a file name, as the name typed would be', () => {
    expect(nextFileName(pattern('Trip: Rome_'), ['Trip Rome_001.png'], day)).toBe('Trip Rome_002');
  });
});

describe('nextFileName by date', () => {
  it('is the day with the name, in the style chosen', () => {
    expect(nextFileName(byDate, [], day)).toBe('2026-11-19_Sample');
    expect(
      nextFileName(
        { ...byDate, datePosition: 'after', order: 'DMY', dateSeparator: '.', nameSeparator: ' ' },
        [],
        day,
      ),
    ).toBe('Sample 19.11.2026');
  });

  it('is only the date without a name', () => {
    expect(nextFileName({ ...byDate, name: '' }, [], day)).toBe('2026-11-19');
  });

  it('does not depend on the files in the folder', () => {
    expect(nextFileName(byDate, ['2026-11-19_Sample.png'], day)).toBe('2026-11-19_Sample');
  });
});

describe('fileNamingFromRow', () => {
  it('reads back what was stored, and nothing that is not a naming', () => {
    const stored = [pattern('Sample_', 3, '_v2'), byDate];
    for (const naming of stored) {
      expect(fileNamingFromRow(JSON.parse(JSON.stringify(naming)))).toEqual(naming);
    }
    expect(fileNamingFromRow(undefined)).toBeUndefined();
    expect(fileNamingFromRow('Sample_')).toBeUndefined();
    expect(
      fileNamingFromRow({ mode: 'pattern', prefix: 'a', suffix: '', digits: 99 }),
    ).toBeUndefined();
    expect(fileNamingFromRow({ ...byDate, order: 'MMDD' })).toBeUndefined();
    expect(fileNamingFromRow({ ...byDate, datePosition: 'middle' })).toBeUndefined();
    expect(fileNamingFromRow({ mode: 'other' })).toBeUndefined();
  });
});
