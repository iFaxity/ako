import { contentType, typeofrequest, Accepts } from './deps.ts';
import { fresh } from './lib/fresh.ts';
import { isIP } from './lib/ip.ts';
import { Context } from './ctx.ts';

const IDEMPOTENT_METHODS = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE'];
const REFERRER_REGEXP = /^referr?er$/i;

//TODO: cache the heavier getters
export class Request {
  readonly ctx: Context;
  readonly originalUrl: string;
  body?: Record<string, any>|string;
  #url?: URL;
  #accept?: Accepts;
  #ip?: string;
  #host?: string;
  #fresh?: boolean;
  #method: string;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.originalUrl = ctx.req.url;
    this.#method = ctx.req.method;
  }

  /**
   * Gets/Sets headers
   */
  get headers() {
    return this.ctx.req.headers;
  }
  set headers(value: Headers) {
    this.ctx.req.headers = value;
  }

  get url(): string {
    const { origin, href } = this.URL;
    return href.substring(origin.length);
  }
  set url(value: string) {
    this.#url = new URL(`${this.origin}${value}`);
  }

  get method(): string {
    return this.#method;
  }
  set method(value: string) {
    this.#method = value.toUpperCase();
  }

  get path(): string {
    return this.URL.pathname;
  }
  set path(value: string) {
    this.URL.pathname = value;
  }

  get query(): URLSearchParams {
    return this.URL.searchParams;
  }
  set query(value: URLSearchParams) {
    throw new Error('Cannot set query, use the URLSearchParams object directly');
  }

  get querystring(): string {
    return this.URL.search.substring(1);
  }
  set querystring(value: string) {
    this.URL.search = `?${value}`;
  }
  get search(): string {
    return this.URL.search;
  }
  set search(value: string) {
    this.URL.search = value;
  }

  get host(): string {
    if (this.#host == null) {
      let host: string = '';
      if (this.ctx.app.proxy) {
        host = this.get('X-Forwarded-Host');
      }
      if (!host && this.ctx.req.protoMajor >= 2) {
        host = this.get(':authority');
      }

      host = host || this.get('Host');
      this.#host = host ? host.split(',', 1)[0].trim() : '';
    }

    return this.#host;
  }
  get hostname(): string {
    const { host } = this;
    return host || (host[0] == '[' ? this.URL.hostname : host.split(':', 1)[0]);
  }
  get URL(): URL {
    return this.#url || (this.#url = new URL(`${this.origin}${this.originalUrl}`));
  }
  get origin(): string {
    return `${this.protocol}://${this.host}`;
  }
  get href(): string {
    return this.URL.href;
  }

  get fresh(): boolean {
    if (this.#fresh == null) {
      const { method } = this;
      const { status } = this.ctx;
      const methodValid = method == 'GET' || method == 'HEAD';
  
      // GET or HEAD for weak freshness validation only
      // 2xx or 304 as per rfc2616 14.26
      if (methodValid && (status >= 200 && status < 300) || status == 304) {
        this.#fresh = fresh(this.headers, this.ctx.response.headers);
      } else {
        this.#fresh = false;
      }
    }

    return this.#fresh;
  }
  get stale(): boolean {
    return !this.fresh;
  }
  get idempotent(): boolean {
    return IDEMPOTENT_METHODS.includes(this.method);
  }

  get charset(): string {
    try {
      const type = this.ctx.req.headers.get('Content-Type');
      if (type) {
        const { parameters } = contentType.parse(type);
        return parameters?.charset ?? '';
      }
    } catch {
      // ignore error
    }
    return '';
  }
  get length(): number {
    return this.ctx.req.contentLength ?? 0;
  }
  get type(): string {
    const type = this.get('Content-Type');
    return type?.split(';')[0] ?? '';
  }

  get protocol(): string {
    if (this.ctx.app.secure) {
      return 'https';
    } else if (this.ctx.app.proxy) {
      const proto = this.get('X-Forwarded-Proto');
      if (proto) {
        return proto.split(',', 1)[0].trim();
      }

      // Check standardised forwarded header
      // Forwarder: for=, proto=
    }

    return 'http';
  }
  get secure(): boolean {
    return this.protocol == 'https';
  }

  get ips(): string[] {
    const { proxy, proxyIpHeader, maxIpsCount } = this.ctx.app;
    if (proxy) {
      const limit = maxIpsCount > 0 ? maxIpsCount : undefined;
      const res = this.get(proxyIpHeader);

      return res ? res.split(/\s*,\s*/, limit) : [];
    }

    return [];
  }
  get ip(): string {
    if (this.#ip == null) {
      const addr = this.ctx.req.conn.remoteAddr as Deno.NetAddr;
      this.#ip = this.ips[0] ?? addr.hostname ?? '';
    }

    return this.#ip;
  }
  set ip(value: string) {
    this.#ip = value;
  }

  get subdomains(): string[] {
    const { hostname } = this;
    if (isIP(hostname) > 0) {
      return [];
    }

    const offset = this.ctx.app.subdomainOffset;
    return hostname.split('.').reverse().slice(offset);
  }

  get accept(): Accepts {
    return this.#accept ??(this.#accept = new Accepts(this.ctx.req.headers));
  }

  set accept(value: Accepts) {
    this.#accept = value;
  }

  accepts(...types: string[]): string[]|null {
    const res = this.accept.types(types);
    return res.length ? res : null;
  }

  acceptsEncodings(...encodings: string[]): string[]|null {
    const res = this.accept.encodings(encodings);
    return res.length ? res : null;
  }

  acceptsCharsets(...charsets: string[]): string[]|null {
    const res = this.accept.charsets(charsets);
    return res.length ? res : null;
  }

  acceptsLanguages(...languages: string[]): string[]|null {
    const res = this.accept.languages(languages);
    return res.length ? res : null;
  }

  is(...types: string[]): string|boolean {
    const { headers } = this.ctx.req;
    return typeofrequest(headers, types) ?? false;
  }

  get(field: string, fallback: string = ''): string {
    const { headers } = this.ctx.req;

    if (REFERRER_REGEXP.test(field)) {
      return headers.get('referrer') ?? headers.get('referer') ?? fallback;
    }
    return headers.get(field) ?? fallback;
  }
}
