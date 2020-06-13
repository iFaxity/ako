import { serve, serveTLS, Server } from './deps.ts';
import { Context, isReader, chain } from './ctx.ts';

export interface AppOptions<S extends object = object> {
  proxy?: boolean;
  proxyIpHeader?: string;
  maxIpsCount?: number;
  subdomainOffset?: number;
  env?: string;
  keys?: string[];
  silent?: boolean;
  state?: S;
  onError?(ex: Error): void;
  onListen?(addr: Deno.NetAddr): void;
}

export type Next = () => Promise<void>;
export interface Middleware {
  (ctx: Context, next: Next): Promise<void>|void
}

// Accessors for decorator pattern
/*export let next: Next;
export let ctx: Context<T>;
*/

export class App<S extends object = object> {
  private readonly onError: (ex: Error) => void;
  private readonly onListen?: (addr: Deno.NetAddr) => void;
  proxy: boolean;
  proxyIpHeader: string;
  maxIpsCount: number;
  middlewares: Middleware[] = [];
  subdomainOffset: number;
  env: string;
  silent: boolean;
  keys?: string[];//Keygrip | string[];
  secure: boolean = false;
  state: S;

  /**
   * @param {AppOptions} [opts] Application options
   */
  constructor(opts: AppOptions<S> = {}) {
    this.proxy = !!opts.proxy;
    this.silent = !!opts.silent;
    this.subdomainOffset = opts.subdomainOffset ?? 2;
    this.proxyIpHeader = opts.proxyIpHeader ?? 'X-Forwarded-For';
    this.maxIpsCount = opts.maxIpsCount ?? 0;
    this.env = opts.env ?? Deno.env.get('DENO_ENV') ?? 'development';
    if (opts.keys) {
      this.keys = opts.keys;
    }

    this.state = opts.state ?? {} as S;

    this.onError = opts.onError ?? this.onerror;
    this.onListen = opts.onListen;
  }

  // Default error handler
  private onerror(ex: Error): void {
    if (!(ex instanceof Error)) {
      throw new TypeError(`non-error thrown: ${JSON.stringify(ex)}`);
    }

    // @ts-ignore
    if (this.silent || (404 == ex.status || ex.expose)) {
      return;
    }

    const msg = ex.stack || ex.toString();
    const message = msg.replace(/^/gm, '  ');
    console.error(`\n${message}\n`);
  }

  private async startListen(server: Server) {
    if (this.onListen) {
      this.onListen(server.listener.addr as Deno.NetAddr);
    }

    for await (const req of server) {
      // Wrap req to request and response object
      const ctx = new Context(this, req);

      try {
        // Chain execute middleware and send response
        await chain(ctx, this.middlewares);
        const { headers, status } = ctx.res;
        const { type, body } = ctx;

        let data: string | Uint8Array | Deno.Reader | undefined;
        if (typeof body == 'string' || isReader(body) || body instanceof Uint8Array) {
          data = body;
        } else if (body == null) {
          data = undefined;
        } else if (typeof body == 'object' && type == 'application/json') {
          data = JSON.stringify(body);
        } else {
          throw new TypeError('Body invalid!');
        }

        await req.respond({ body: data, headers, status });
      } catch(ex) {
        this.onError(ex);
      }
    }
  }

  listenTls(opts: Deno.ListenTlsOptions): Promise<void> {
    this.secure = true;
    return this.startListen(serveTLS(opts));
  }

  listen(opts: string | Deno.ListenOptions): Promise<void> {
    return this.startListen(serve(opts));
  }

  //use(middleware: Middleware): void;
  //use(): (target: Middleware) => void;
  use(middleware: Middleware): void {
    /*if (!middleware) {
      return (target: Middleware) => this.use(target);
    }*/

    this.middlewares.push(middleware);
  }
}

export function createApp<S extends object = object>(opts?: AppOptions<S>): App<S> {
  return new App(opts);
}
