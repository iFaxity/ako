import {
  pathToRegexp,
  compile,
  parse,
  TokensToRegexpOptions,
  ParseOptions,
  Key
} from 'https://deno.land/x/path_to_regexp/mod.ts';
import { Middleware, Context, Next } from './app.ts';
import { upper, decodeURIComponent } from './shared.ts';

interface RouterOptions {
  prefix?: string;
  methods?: string[];
}

interface ParamMiddleware extends Middleware {
  (id: string, ctx: Context, next: Next): Promise<void>|void;
}
interface ParamMiddlewareFactory extends Middleware {
  param: string;
}
type Params = Record<string|number, any>;

const METHODS = [
  'HEAD',
  'OPTIONS',
  'GET',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
];

interface RouteOptions extends TokensToRegexpOptions, ParseOptions {
  name?: string;
  ignoreCaptures?: boolean;
}

class Route {
  name?: string;
  methods: string[];
  keys: (string|number)[];
  stack: Middleware[];
  opts: RouteOptions;
  path: string;
  regexp: RegExp;

  constructor(
    path: string|RegExp,
    methods: string[],
    middlewares: Middleware[],
    opts: RouteOptions = {}
  ) {
    this.opts = opts;
    this.path = path instanceof RegExp ? path.source : path;
    this.stack = Array.isArray(middlewares) ? middlewares : [middlewares];
    if (opts.name) {
      this.name = opts.name;
    } else if (this.stack.some(fn => typeof fn != 'function')) {
      throw new Error('Middleware is not a function');
    }

    // Map methods
    this.methods = methods.reduce((acc, method) => {
      method = upper(method);

      if (method != 'HEAD' && !methods.includes('GET')) {
        acc.push(method);
      }

      return acc;
    }, [] as string[]);

    const keys: Key[] = [];
    this.regexp = pathToRegexp(path, keys, opts);
    this.keys = keys.map(k => k.name);
  }

  params(captures: string[], params: Params = {}): object {
    const { keys } = this;
    const len = Math.min(this.keys.length, captures.length);

    for (let i = 0; i < len; i++) {
      const capture = captures[i];
      params[keys[i]] = decodeURIComponent(capture) ?? capture;
    }
    return params;
  }

  match(path: string): boolean {
    return this.regexp.test(path);
  }

  captures(path: string): string[] {
    let res: string[]|undefined;

    if (!this.opts.ignoreCaptures) {
      res = path.match(this.regexp)?.slice(1);
    }
    return res ?? [];
  }

  url(params?: Params, opts: Record<string|number, any> = {}): string {
    const url: string = this.path.replace(/\(\.\*\)/g, '');
    const toPath = compile(url, opts);
    const names = parse(url).map(t => typeof t == 'string' ? t : t.name);
    let replace: Params|undefined = {};

    if (params instanceof Array) {
      let i = 0;
      for (const name of names) {
        replace[name] = params[i++];
      }
    } else if (names.some(n => n)) {
      replace = params;
    } else {
      opts = params;
    }

    let replaced = toPath(replace);
    if (opts && opts.query) {
      replaced = parseUrl(replaced);

      if (typeof opts.query == 'string') {
        replaced.search = opts.query;
      } else {
        replaced.search = undefined;
        replaced.query = optis.query;
      }
      return formatUrl(replaced);
    }

    return replaced;
  }

  param(param: string, fn: ParamMiddleware): this {
    const { stack, keys } = this;
    const middleware: ParamMiddlewareFactory = (ctx, next) => {
      return fn(ctx.params[param], ctx, next);
    };
    middleware.param = param;

    const idx = keys.indexOf(param);
    if (idx != -1) {
      // iterate through the stack, to figure out where to place the handler fn
      stack.some((m, i) => {
        // param handlers are always first, so when we find an fn w/o a param property, stop here
        // if the param handler at this part of the stack comes after the one we are adding, stop here
        const pm = m as ParamMiddlewareFactory;
        if (!pm.param || keys.indexOf(pm.param) > idx) {
          // inject this param handler right before the current item
          return stack.splice(i, 0, middleware), true;
        }
      });
    }

    return this;
  }
}

export class Router {
  #prefix: string;
  #methods: string[];
  #params: Record<string, Middleware>;
  // middleware or route
  #stack: (Middleware|Route)[] = [];

  get prefix(): string {
    return this.#prefix;
  }

  set prefix(value: string) {
    this.#prefix = value.endsWith('/') ? value.slice(0, -1) : value;
  }

  constructor(opts: RouterOptions = {}) {
    this.#stack = [];
    this.#params = {};
    this.#prefix = opts.prefix ?? '';
    this.#methods = opts.methods || METHODS;
  }

  all(name: string, ...middlewares: Middleware[]): this {
    return this.addRoute(name, [ 'GET', 'PUT', 'POST', 'DELETE' ], middlewares);
  }
  get(name: string, ...middlewares: Middleware[]): this {
    return this.addRoute(name, ['GET'], middlewares);
  }
  put(name: string, ...middlewares: Middleware[]): this {
    return this.addRoute(name, ['PUT'], middlewares);
  }
  post(name: string, ...middlewares: Middleware[]): this {
    return this.addRoute(name, ['POST'], middlewares);
  }
  delete(name: string, ...middlewares: Middleware[]): this {
    return this.addRoute(name, [ 'DELETE' ], middlewares);
  }
  use(...middlewares: Middleware[]): this {
    this.#stack.push(...middlewares);
    return this;
  }

  private addRoute(name: string, methods: string[], middlewares: Middleware[]): this {
    this.#stack.push(new Route(name, methods, middlewares));
    return this;
  }

  redirect(src: string, dst: string, status: number=301): this {
    const srcUrl = src[0] == '/' ? src : this.url(src);
    const dstUrl = dst[0] == '/' ? dst : this.url(dst);

    if (srcUrl == null || dstUrl == null) {
      const name = srcUrl ? 'destination' : 'source';
      throw new TypeError(`Redirection ${name} does not exist.`);
    }

    return this.all(srcUrl, ctx => {
      ctx.redirect(dstUrl);
      ctx.status = status;
    });
  }

  route(name: string): Route|null {
    return this.#stack.find(r => {
      return r instanceof Route && r.name === name;
    }) as Route|null;
  }

  url(name: string, params?: Params, query?: string|Params): string|null {
    const route = this.route(name);
    return route ? route.url(params, opts) : null;
  }

  param(param: string, middleware: ParamMiddleware): this {
    this.#params[param] = middleware;
    for (const route of this.#stack) {
      if (route instanceof Route) {
        route.param(param, middleware);
      }
    }

    return this;
  }

  static url(path: string, params: Params): string {
    return '';
  }

  routes() {
    // get all routes
  }
}

export function createRouter(opts: RouterOptions) {
  return new Router(opts);
}
