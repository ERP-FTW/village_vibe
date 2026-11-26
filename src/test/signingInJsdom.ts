/**
 * Import this first in a jsdom test that signs or encrypts for real.
 *
 * Under jsdom the global Uint8Array is jsdom's, while Node's TextEncoder returns Node's.
 * The signing code (@noble) rejects the mismatch. Re-wrapping what TextEncoder returns is
 * enough; it has to happen before nostr-tools is loaded, because that keeps one encoder.
 */
const NodeTextEncoder = globalThis.TextEncoder;

globalThis.TextEncoder = class extends NodeTextEncoder {
  encode(input?: string) {
    return new Uint8Array(super.encode(input));
  }
} as typeof TextEncoder;
