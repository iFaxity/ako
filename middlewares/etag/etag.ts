/*!
 * etag
 * Copyright(c) 2014-2016 Douglas Christopher Wilson
 * MIT Licensed
 */

import { Sha1, Message } from 'https://deno.land/std@v0.57.0/hash/sha1.ts';
import * as base64 from 'https://deno.land/std@v0.57.0/encoding/base64.ts';

const EMPTY = '0-2jmj7l5rSw0yVb/vlWAYkK/YBwk';

/**
 * Generate an entity tag.
 */
function entityTag(entity: Message): string {
  const length = entity instanceof ArrayBuffer ? entity.byteLength : entity.length;
  if (!length) {
    // fast-path empty
    return EMPTY;
  }

  // compute hash of entity
  const sha1 = new Sha1();
  const buffer = sha1.update(entity).arrayBuffer();
  const hash = base64.encode(buffer).substring(0, 27);

  return `${buffer.byteLength.toString(16)}-${hash}`;
}

/**
 * Create a simple ETag.
 */
export default function etag(entity: Message|Deno.FileInfo, weak: boolean = false): string {
  if (entity == null) {
    throw new TypeError('argument entity is required')
  }

  // support Deno.FileInfo
  let res: string;
  if (isStat(entity)) {
    weak = true;
    res = statTag(entity);
  } else {
    // validate argument
    if (typeof entity != 'string' && !Array.isArray(entity) && entity instanceof ArrayBuffer) {
      throw new TypeError('argument entity must be string, Buffer, or fs.Stats')
    }

    res = entityTag(entity);
  }

  return weak ? `W/"${res}"` : `"${res}"`;
}

/**
 * Determine if object is a Deno.FileInfo object.
 */
function isStat(stat: any): stat is Deno.FileInfo {
  // quack quack
  return (
    (stat != null && typeof stat == 'object') &&
    typeof stat.size == 'number' &&
    (stat.mtime == null || stat.mtime instanceof Date)
  );
}

/**
 * Generate a tag from a FileInfo.
 */
function statTag(stat: Deno.FileInfo): string {
  const { size } = stat;
  const mtime = stat.mtime ? stat.mtime.getTime() : 0;
  return `"${size.toString(16)}-${mtime.toString(16)}"`;
}
