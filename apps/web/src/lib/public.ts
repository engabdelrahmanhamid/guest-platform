import 'server-only';
import { publicClientKey } from '@gp/core';
import { getCoreContext } from './server';
import { requestMeta } from './session';

/** The keyed hash that public pages rate-limit by. The IP address itself is never stored. */
export async function publicClient(): Promise<string> {
  const { ip } = await requestMeta();
  return publicClientKey(ip, getCoreContext().encryptionKey);
}
