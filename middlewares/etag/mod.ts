/**
 * Module dependencies.
 */

import compute from './etag.ts';
import { isReader } from '../../shared.ts';
import { Middleware } from '../../app.ts';
import { Context } from '../../ctx.ts';

/**
 * Add ETag header field.
 */
export default function etag(weak?: boolean): Middleware {
  return (ctx, next) => {
    return next().then(() => {
      const entity = resolveEntity(ctx);
      if (entity) {
        ctx.response.etag = compute(entity, weak);
      }
    });
  };
}

// Body = string | object | any[] | Uint8Array | Deno.Reader | null | undefined;
function resolveEntity(ctx: Context): void|string|Uint8Array|Deno.FileInfo {
  // no body
  const { body } = ctx;
  const status = ctx.status / 100 | 0;
  if (!body || status != 2 || ctx.response.has('ETag')) {
    return;
  }

  if (isReader(body) && ctx.response.etagEntity) {
    return ctx.response.etagEntity;
  } else if (typeof body == 'string' || body instanceof Uint8Array) {
    return body;
  }

  return JSON.stringify(body);
}
