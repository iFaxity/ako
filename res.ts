import { STATUS_TEXT, typeofrequest, vary, mime, path } from './deps.ts';
import { contentDisposition, ContentDispositionOptions } from './lib/contentDisposition.ts';
import { Context, Body, isReader } from './ctx.ts';

const encoder = new TextEncoder();
function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export class Response {
  readonly ctx: Context;

  #body: Body = null;
  #explicitStatus: boolean = false;
  #writable: boolean = true;
  /** Only used for send module to communicate with etag module */
  etagEntity?: Deno.FileInfo;
  #length?: number|null;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  // TODO: Fix this somehow
  get headerSent(): boolean {
    return false;
  }
  get writable(): boolean {
    return this.#writable;
  }

  get headers(): Headers {
    return this.ctx.res.headers;
  }
  set headers(value: Headers) {
    this.ctx.res.headers = value;
  }

  get status(): number {
    return this.ctx.res.status;
  }
  set status(value: number) {
    if (value < 100 || value > 600) {
      throw new TypeError(`Invalid status code: ${value}`);
    }

    this.ctx.res.status = value;
    this.#explicitStatus = true;
  }

  get message(): string {
    return STATUS_TEXT.get(this.status) ?? '';
  }
  set message(value: string) {
    console.error('Setting the ctx.message property is not available for Koa yet.');
  }

  get body(): Body {
    return this.#body;
  }
  set body(value: Body) {
    const original = this.ctx.res.body;
    this.#body = value;

    // no content
    if (value == null) {
      const { status } = this;
      if (status == 204 || status == 205 || status == 304) {
        this.ctx.res.status = 204;
      }

      //this.explicitNullBody = true;
      this.remove('Content-Type', 'Content-Length', 'Transfer-Encoding');
      return;
    }

    // prevent overwriting status
    if (!this.#explicitStatus) {
      this.status = 200;
    }

    // set the content-type only if not yet set
    const shouldSetType = !this.has('Content-Type');

    if (typeof value == 'string') {
      if (shouldSetType) {
        this.type = /^\s*</.test(value) ? 'html' : 'text';
      }
      this.#length = byteLength(value);
    } else if (value instanceof Uint8Array) {
      if (shouldSetType) {
        this.type = 'bin';
      }
      this.#length = value.length;
    } else if (isReader(value)) {
      if (original != value && original == null) {
        this.#length = null;
        this.remove('Content-Length');
      }

      if (shouldSetType) {
        this.type = 'bin';
      }
    } else {
      this.#length = null;
      this.remove('Content-Length');
      this.type = 'json';
    }
  }

  get length(): number {
    let len = this.#length;

    if (len == null) {
      const body = this.#body;
      if (!body) {
        len = 0;
      } else if (body instanceof Uint8Array) {
        len = body.length;
      } else {
        len = byteLength(typeof body == 'string' ? body : JSON.stringify(body));
      }
      this.#length = len;
    }

    return len;
  }
  set length(value: number) {
    this.#length = value;
    this.set('Content-Length', String(value));
  }

  vary(field: string): void {
    vary(this.headers, field);
  }

  redirect(url: string, alt?: string): void {
    const { status, ctx } = this;
    // location
    if (url == 'back') {
      url = ctx.get('Referrer') || alt || '/';
    }
    this.set('Location', encodeURI(url));

    // set status
    if (status >= 300 && status <= 308) {
      this.status = 302;
    }

    // html
    if (ctx.request.accepts('html')) {
      url = escape(url);
      this.type = 'text/html; charset=utf-8';
      this.body = `Redirecting to <a href="${url}">${url}</a>.`;
    } else {
      // text
      this.type = 'text/plain; charset=utf-8';
      this.body = `Redirecting to ${url}.`;
    }
  }

  attachment(filename: string, opts?: ContentDispositionOptions) {
    this.type = path.extname(filename);
    this.set('Content-Disposition', contentDisposition(filename, opts));
  }

  get type(): string {
    const type = this.get('Content-Type');
    return type ? type.split(';', 1)[0] : '';
  }
  set type(value: string) {
    const type = mime.contentType(value);
    type ? this.set('Content-Type', type) : this.remove('Content-Type');
  }

  get lastModified(): Date|string|undefined {
    const date = this.get('Last-Modified');
    return date ? new Date(date) : undefined;
  }
  set lastModified(value: Date|string|undefined) {
    if (!value) {
      this.remove('Last-Modified');
    } else {
      if (typeof value == 'string') {
        value = new Date(value);
      }
      this.set('Last-Modified', value.toUTCString());
    }
  }

  get etag(): string {
    return this.get('ETag');
  }
  set etag(value: string) {
    const shouldQuote = !/^(W\/)?"/.test(value);
    this.set('ETag', shouldQuote ? `"${value}"` : value);
  }

  is(...types: string[]): string|boolean {
    return typeofrequest(this.headers, types) ?? false;
  }

  get(field: string, def: string = ''): string {
    return this.headers.get(field) ?? def;
  }
  has(field: string): boolean {
    return this.headers.has(field);
  }

  set(field: string, value: string|string[]): void;
  set(field: Record<string, string>): void;
  set(field: string|Record<string, string>, value?: string|string[]): void {
    if (typeof field != 'string') {
      for (const key of Object.keys(field)) {
        this.set(key, field[key]);
      }
    } else {
      const { headers } = this;

      if (!Array.isArray(value)) {
        headers.set(field, String(value));
      } else if (value.length) {
        headers.set(field, String(value[0]));

        for (let i = 1; i < value.length; i++) {
          headers.append(field, String(value[i]));
        }
      }
    }
  }

  append(field: string, value: string|string[]): void {
    const { headers } = this;
    const list = Array.isArray(value) ? value : [value];

    for (const item of list) {
      headers.append(field, item);
    }
  }

  remove(...fields: string[]): void {
    for (const field of fields) {
      this.ctx.res.headers.delete(field);
    }
  }

  flushHeaders(): void {
    this.headers = new Headers();
  }
}
