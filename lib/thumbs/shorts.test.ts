import { isShortFromStatus } from './shorts';
test('200 on oardefault means Short, 404 means long-form', () => {
  expect(isShortFromStatus(200)).toBe(true);
  expect(isShortFromStatus(404)).toBe(false);
});
