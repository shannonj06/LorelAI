import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password, salt, { N, r, p }) {
  // NFKC so the same password typed on different keyboards/OSes hashes the same
  return scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r });
}

function parse(stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger)) return null;
  return { params: { N, r, p }, salt: Buffer.from(parts[4], 'base64'), key: Buffer.from(parts[5], 'base64') };
}

/**
 * scrypt password hashing (built into Node, no native module).
 * Hashes look like scrypt$N$r$p$salt$key, so the cost can be raised later:
 * needsRehash() flags old hashes and sign-in upgrades them.
 *
 * cost is log2(N). The default 16 (N=65536, r=8, p=2) is one of OWASP's
 * recommended scrypt settings: about 64 MB and ~150 ms per hash.
 */
export function createPasswordHasher({ cost = 16, blockSize = 8, parallelization = 2 } = {}) {
  const params = { N: 2 ** cost, r: blockSize, p: parallelization };
  let dummyHash = null;

  const hash = async (password) => {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, params);
    return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
  };

  return {
    hash,

    async verify(password, stored) {
      const parsed = parse(stored);
      if (!parsed) return false;
      const key = await derive(password, parsed.salt, parsed.params);
      return key.length === parsed.key.length && crypto.timingSafeEqual(key, parsed.key);
    },

    needsRehash(stored) {
      const parsed = parse(stored);
      return !parsed || parsed.params.N !== params.N || parsed.params.r !== params.r || parsed.params.p !== params.p;
    },

    /** A real hash to verify against when the account doesn't exist, so timing doesn't reveal which emails are registered. */
    async dummyHash() {
      dummyHash ??= await hash(crypto.randomBytes(16).toString('hex'));
      return dummyHash;
    },
  };
}
