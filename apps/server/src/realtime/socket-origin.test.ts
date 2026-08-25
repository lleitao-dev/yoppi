import { describe, expect, it } from 'vitest';
import { isAllowedSocketRequest } from './socket-origin';

describe('Socket.IO request origin validation', () => {
  const webOrigin = 'https://staging.yoppi.app';

  it('allows the configured browser origin', () => {
    expect(
      isAllowedSocketRequest('https://staging.yoppi.app', 'staging.yoppi.app', webOrigin),
    ).toBe(true);
  });

  it('rejects a foreign browser origin', () => {
    expect(isAllowedSocketRequest('https://example.com', 'staging.yoppi.app', webOrigin)).toBe(
      false,
    );
  });

  it('allows an origin-less same-host request', () => {
    expect(isAllowedSocketRequest(undefined, 'staging.yoppi.app', webOrigin)).toBe(true);
  });

  it('rejects an origin-less request for another host', () => {
    expect(isAllowedSocketRequest(undefined, '134.122.116.23', webOrigin)).toBe(false);
  });

  it('rejects an origin-less request with no host header', () => {
    expect(isAllowedSocketRequest(undefined, undefined, webOrigin)).toBe(false);
  });
});
