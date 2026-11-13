const KEY_PREFIX = 'sporty_';
const KEY_PATTERN = /^sporty_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/;

/**
 * Reports whether a string has the shape of a Statpad API key: `sporty_`, 16 base64url
 * characters, a dot, and 43 base64url characters, each part canonical unpadded base64url.
 * It checks the format only. Whether the key is current is for the API to say.
 */
export function isWellFormedApiKey(key: string): boolean {
  if (!KEY_PATTERN.test(key)) return false;
  return key
    .slice(KEY_PREFIX.length)
    .split('.')
    .every((part) => toBase64Url(fromBase64Url(part)) === part);
}

function fromBase64Url(part: string): string {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

function toBase64Url(binary: string): string {
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
