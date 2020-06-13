export function lower(str: string): string {
  return str.toLowerCase();
}

export function upper(str: string): string {
  return str.toUpperCase();
}

const encoder = new TextEncoder();
export function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isReader(value: any): value is Deno.Reader {
  return typeof value?.read == 'function';
}

export function decodeURIComponent(path: string): string|null {
  try {
    return globalThis.decodeURIComponent(path);
  } catch {
    return null;
  }
}


/**
 * RegExp to match chars that must be quoted-pair in RFC 2616
 */
const QUOTE_REGEXP = /([\\"])/g;

/**
 * Quote a string if necessary.
 */
export function quoteString(value: string): string {
  return `"${value.replace(QUOTE_REGEXP, '\\$1')}"`;
}
