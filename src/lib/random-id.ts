/**
 * A random id for a file's storage name.
 *
 * Not `crypto.randomUUID()`: browsers give that only to a secure page (https
 * or localhost), and the app opened on a phone over the LAN
 * (http://192.168.x.x) is not one, so every upload there crashed with "The
 * image didn't upload" (Sada, 3 Nov 2026). `getRandomValues` is available on
 * any page, and is the same randomness.
 */
export function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
