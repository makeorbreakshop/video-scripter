import { avatarCacheUrl, thumbUrl } from './storage';

describe('avatarCacheUrl', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_THUMBS_BASE_URL = 'https://thumbs.example/'; });
  it('points at the avatar copy in the thumbs bucket', () => {
    expect(avatarCacheUrl('UC6x7GwJxuoABSosgVXDYtTw')).toBe('https://thumbs.example/avatars/UC6x7GwJxuoABSosgVXDYtTw.jpg');
  });
  it('refuses anything that is not a channel id (the worker would 404 it anyway)', () => {
    expect(avatarCacheUrl('../etc')).toBeNull();
  });
  it('is null when no bucket is configured, like thumbUrl', () => {
    delete process.env.NEXT_PUBLIC_THUMBS_BASE_URL; delete process.env.THUMBS_BASE_URL;
    expect(avatarCacheUrl('UC6x7GwJxuoABSosgVXDYtTw')).toBeNull();
    expect(thumbUrl('abc', 1)).toBeNull();
  });
});
