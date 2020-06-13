import { Middleware } from '../../app.ts';

export default function conditional(): Middleware {
  return (ctx, next) => next().then(() => {
    if (ctx.fresh) {
      ctx.status = 304;
      ctx.body = null;
    }
  });
}
