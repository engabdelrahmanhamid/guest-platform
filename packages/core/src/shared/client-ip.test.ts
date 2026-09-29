import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('takes the entry the nearest trusted proxy appended, not what the client sent', () => {
    // Client claimed 1.1.1.1; the proxy appended the real 203.0.113.9.
    expect(clientIp('1.1.1.1, 203.0.113.9', 1)).toBe('203.0.113.9');
    expect(clientIp('203.0.113.9', 1)).toBe('203.0.113.9');
    // Two proxies: client, then the first proxy's address.
    expect(clientIp('9.9.9.9, 203.0.113.9, 10.0.0.2', 2)).toBe('203.0.113.9');
  });
  it('trusts nothing without a proxy, and nothing that is missing', () => {
    expect(clientIp('1.1.1.1', 0)).toBeUndefined();
    expect(clientIp(null, 1)).toBeUndefined();
    expect(clientIp('', 1)).toBeUndefined();
    expect(clientIp('1.1.1.1', 2)).toBeUndefined();
  });
});
