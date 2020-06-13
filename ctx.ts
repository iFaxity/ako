import { ServerRequest, Response as Res, Accepts } from './deps.ts';
import { App, Middleware } from './app.ts';
import { Request } from './req.ts';
import { Response } from './res.ts';
import { send, SendOptions } from './send.ts';
import { CookieJar } from './lib/cookie.ts';

export type Body = string | object | any[] | null | undefined | Uint8Array | Deno.Reader;
export function isReader(value: any): value is Deno.Reader {
  return typeof value?.read == 'function';
}

export interface ServerResponse extends Res {
  headers: Headers;
  status: number;
}

export class HttpError extends Error {
  [key: string]: any;
  status: number;
  expose: boolean = true;

  constructor(status: number, msg?: string, props?: object) {
    // if message is empty, use default message
    super(msg);
    this.status = status;

    if (props != null) {
      Object.assign(this, props);
    }
  }
}

// Composes middlewares into an async chain
export function chain(ctx: Context, middlewares: Middleware[]): Promise<void> {
  let id = -1; // last called middleware id

  async function dispatch(idx: number): Promise<void> {
    if (idx <= id) {
      throw new Error('next() called multiple times');
    }

    id = idx;
    const next = () => dispatch(idx + 1);
    const fn = idx == middlewares.length ? next : middlewares[idx];
    return fn?.(ctx, next);
  }
  return dispatch(0);
}


export class Context<S extends object = object> {
  readonly app: App<S>;
  readonly req: ServerRequest;
  readonly res: ServerResponse;
  readonly request: Request;
  readonly response: Response;
  readonly state: S;
  #cookies?: CookieJar;

  constructor(app: App<S>, req: ServerRequest) {
    this.app = app;
    this.req = req;
    this.res = {
      status: 404,
      headers: new Headers(),
    };

    this.state = app.state;
    this.request = new Request(this);
    this.response = new Response(this);
  }

  throw(status: number=500, msg?: string, props?: object): never {
    throw new HttpError(status, msg, props);
  }

  // delegated from response
  attachment(filename: string, opts?: object): void {
    this.response.attachment(filename, opts);
  }
  redirect(url: string, alt?: string): void {
    this.response.redirect(url, alt);
  }
  remove(field: string): void {
    this.response.remove(field);
  }
  vary(field: string): void {
    this.response.vary(field);
  }
  has(field: string): boolean {
    return this.response.has(field);
  }
  set(header: string, value: string): void {
    this.response.set(header, value);
  }
  append(field: string, value: string|string[]): void {
    this.response.append(field, value);
  }
  flushHeaders(): void {
    this.response.flushHeaders();
  }
  get headerSent(): boolean {
    return this.response.headerSent;
  }
  get writable(): boolean {
    return this.response.writable;
  }
  get status(): number {
    return this.response.status;
  }
  set status(value: number) {
    this.response.status = value;
  }
  get message(): string {
    return this.response.message;
  }
  set message(value: string) {
    this.response.message = value;
  }
  get body(): Body {
    return this.response.body;
  }
  set body(value: Body) {
    this.response.body = value;
  }
  get length(): number {
    return this.response.length;
  }
  set length(value: number) {
    this.response.length = value;
  }
  get lastModified(): string|Date|undefined {
    return this.response.lastModified;
  }
  set lastModified(value: string|Date|undefined) {
    this.response.lastModified = value;
  }
  get etag(): string {
    return this.response.etag;
  }
  set etag(value: string) {
    this.response.etag = value;
  }

  get type(): string {
    return this.response.type;
  }
  set type(value: string) {
    this.response.type = value;
  }

  // delegated from request
  acceptsLanguages(...args: string[]): string|string[]|null {
    return this.request.acceptsLanguages(...args);
  }
  acceptsEncodings(...args: string[]): string|string[]|null {
    return this.request.acceptsEncodings(...args);
  }
  acceptsCharsets(...args: string[]): string|string[]|null {
    return this.request.acceptsCharsets(...args);
  }
  accepts(...args: string[]): string|string[]|null {
    return this.request.accepts(...args);
  }
  get(field: string): string {
    return this.request.get(field);
  }
  is(...types: string[]): string|boolean {
    return this.request.is(...types);
  }

  get querystring(): string {
    return this.request.querystring;
  }
  set querystring(value: string) {
    this.request.querystring = value;
  }
  get search(): string {
    return this.request.search;
  }
  set search(value: string) {
    this.request.search = value;
  }
  get method(): string {
    return this.request.method;
  }
  set method(value: string) {
    this.request.method = value;
  }
  get query(): URLSearchParams {
    return this.request.query;
  }
  set query(value: URLSearchParams) {
    this.request.query = value;
  }
  get path(): string {
    return this.request.path;
  }
  set path(value: string) {
    this.request.path = value;
  }
  get url(): string {
    return this.request.url;
  }
  set url(value: string) {
    this.request.url = value;
  }
  get accept(): Accepts {
    return this.request.accept;
  }
  set accept(value: Accepts) {
    this.request.accept = value;
  }

  get idempotent(): boolean {
    return this.request.idempotent;
  }
  get origin(): string {
    return this.request.origin;
  }
  get href(): string {
    return this.request.href;
  }
  get subdomains(): string[] {
    return this.request.subdomains;
  }
  get protocol(): string {
    return this.request.protocol;
  }
  get host(): string {
    return this.request.host;
  }
  get hostname(): string {
    return this.request.hostname;
  }
  get URL(): URL {
    return this.request.URL;
  }
  get header(): Headers {
    return this.request.headers;
  }
  get headers(): Headers {
    return this.request.headers;
  }
  get secure(): boolean {
    return this.request.secure;
  }
  get stale(): boolean {
    return !this.fresh;
  }
  get fresh(): boolean {
    return this.request.fresh;
  }
  get ips(): string[] {
    return this.request.ips;
  }
  get ip(): string {
    return this.request.ip;
  }

  // Unique
  get cookies(): CookieJar {
    if (!this.#cookies) {
      this.#cookies = new CookieJar(this, {
        keys: this.app.keys,
        secure: this.request.secure,
      });
    }

    return this.#cookies;
  }

  set cookies(cookies: CookieJar) {
    this.#cookies = cookies;
  }

  send(path: string, opts?: SendOptions): Promise<string|void> {
    return send(this, path, opts);
  }
}
