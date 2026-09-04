import { sizedAvatarUrl } from './avatar-url';

describe('sizedAvatarUrl', () => {
  it('asks the YouTube CDN for 2x the rendered size instead of the stored 800px', () => {
    expect(sizedAvatarUrl('https://yt3.ggpht.com/abc=s800-c-k-c0x0', 36)).toBe('https://yt3.ggpht.com/abc=s72-c-k-c0x0');
    expect(sizedAvatarUrl('https://yt3.ggpht.com/abc=s88', 28)).toBe('https://yt3.ggpht.com/abc=s56');
  });
  it('leaves URLs without a size token alone', () => {
    expect(sizedAvatarUrl('https://example.com/a.jpg', 36)).toBe('https://example.com/a.jpg');
  });
});
