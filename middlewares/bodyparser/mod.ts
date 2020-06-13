import { Middleware } from '../../app.ts';

const ALLOWED_METHODS = [ 'POST', 'PUT', 'PATCH' ];

export default function bodyparser(): Middleware {
  return async (ctx, next) => {
    // no/empty body
    if (ALLOWED_METHODS.includes(ctx.method) && ctx.request.length) {
      const type = ctx.is('json', 'urlencoded', 'text', 'xml');

      if (type) {
        const decoder = new TextDecoder(ctx.request.charset || 'utf8');
        const buffer = await Deno.readAll(ctx.req.body);
        const body = decoder.decode(buffer);

        if (type == 'json') {
          ctx.request.body = JSON.parse(body);
        } else if (type == 'urlencoded') {
          const params = new URLSearchParams(body).entries();
          ctx.request.body = Object.fromEntries(params);
        } else {
          ctx.request.body = body;
        }
      }
    }

    return next();
  };
}
