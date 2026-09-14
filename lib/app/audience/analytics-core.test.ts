import { audienceWindow, reportRows } from './analytics-core';

test('maps Analytics API headers rather than assuming a column order', () => {
  expect(reportRows('age_gender', { columnHeaders: [{ name: 'viewerPercentage' }, { name: 'gender' }, { name: 'ageGroup' }], rows: [[21.4, 'male', 'age25-34']] }))
    .toEqual([{ dimension: 'age_gender', key: 'age25-34|male', value: 21.4 }]);
  expect(reportRows('country', { columnHeaders: [{ name: 'country' }, { name: 'views' }], rows: [['US', 42]] }))
    .toEqual([{ dimension: 'country', key: 'US', value: 42 }]);
  expect(() => reportRows('device', { columnHeaders: [{ name: 'views' }], rows: [[42]] })).toThrow('missing columns');
});

test('window ends yesterday and spans 90 inclusive days', () => {
  expect(audienceWindow(new Date('2026-09-14T12:00:00Z'))).toEqual({ startDate: '2026-06-16', endDate: '2026-09-13' });
});
