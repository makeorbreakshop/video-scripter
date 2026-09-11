import { transactionPreambleSql } from './db';

test('the transaction preamble sets a server-visible component name locally', () => {
  expect(transactionPreambleSql(30_000, "video-scripter:score'worker")).toBe(
    "begin; set local statement_timeout = 30000; select set_config('application_name', 'video-scripter:score''worker', true)",
  );
});

test('the transaction preamble remains unchanged for untagged callers', () => {
  expect(transactionPreambleSql(45_000)).toBe('begin; set local statement_timeout = 45000');
});
