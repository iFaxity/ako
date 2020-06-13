import { HmacSha256, HmacSha512, base64url } from '../deps.ts';

export class Keygrip {
  #keys: string[];
  #decoder: TextDecoder;
  #algo: string;

  constructor(keys: string[], algo: string='sha256', enc: string='base64') {
    if (!keys || !keys.length) {
      throw new Error('Keys must be provided.');
    } else if (algo != 'sha256' && algo != 'sha512') {
      throw new Error('Algorithm not found');
    }

    this.#keys = keys;
    this.#algo = algo;
    this.#decoder = new TextDecoder(enc);
  }

  sign(data: string, key?: string): string {
    let buffer: ArrayBuffer;
    key = key ?? this.#keys[0];

    if (this.#algo == 'sha256') {
      const hash = new HmacSha256(key);
      buffer = hash.update(data).arrayBuffer();
    } else if (this.#algo == 'sha512') {
      const hash = new HmacSha512(key);
      buffer = hash.update(data).arrayBuffer();
    }

    //@ts-ignore
    return base64url.encode(this.#decoder.decode(buffer));
  }

  verify(data: string, digest: string): boolean {
    return this.index(data, digest) != -1;
  }

  index(data: string, digest: string): number {
    return this.#keys.findIndex(key => digest === this.sign(data, key));
  }
}
