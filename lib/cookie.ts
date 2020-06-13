/*!
 * cookies
 * Copyright(c) 2014 Jed Schmidt, http://jed.is/
 * Copyright(c) 2015-2016 Douglas Christopher Wilson
 * MIT Licensed
 */
import { getCookies, setCookie, deleteCookie, Cookie } from '../deps.ts';
import { Context, ServerResponse } from '../ctx.ts';
import { Keygrip } from './keygrip.ts';
import { Middleware } from '../app.ts';

/**
 * RegExp to match field-content in RFC 7230 sec 3.2
 *
 * field-content = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 * field-vchar   = VCHAR / obs-text
 * obs-text      = %x80-FF
 */
const FIELD_CONTENT_REGEXP = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;
const SAME_SITE = [ true, 'strict', 'lax', 'none' ];

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  signed?: boolean;
  overwrite?: boolean;
  sameSite?: 'strict' | 'lax' | 'none' | true;
}

export interface CookieJarOptions {
  keys?: string[]|Keygrip;
  secure?: boolean;
}

export class CookieJar extends Map<string, string> {
  #res: ServerResponse;
  #secure?: boolean;
  #keys?: Keygrip;

  constructor(ctx: Context, opts?: CookieJarOptions) {
    super();
    this.#res = ctx.res;
    this.#secure = ctx.secure;

    if (opts) {
      const { secure, keys } = opts;
      if (keys) {
        this.#keys = keys instanceof Keygrip ? keys : new Keygrip(keys);
      }

      this.#secure = !!secure;
    }

    // Set initial cookies
    const cookies = getCookies(ctx.req);
    for (const key of Object.keys(cookies)) {
      super.set(key, cookies[key]);
    }
  }

  get(name: string, opts?: Pick<CookieOptions, 'signed'>): string|undefined {
    const signed = opts?.signed ?? !!this.#keys;
    const value = super.get(name);
    if (!signed) {
      return value;
    }

    const signedName = `${name}.sig`;
    const remote = super.get(signedName);
    if (remote) {
      const data = `${name}=${value}`;
      if (!this.#keys) {
        throw new Error('Keys required for signed cookies');
      }

      const idx = this.#keys.index(data, remote);
      if (idx == -1) {
        this.delete(signedName);
      } else {
        if (idx) {
          this.set(signedName, this.#keys.sign(data), { signed: false });
        }
        return value;
      }
    }
  }

  set(name: string, value: any, opts: CookieOptions = {}): this {
    if (!value) {
      this.delete(name);
      return this;
    }

    const strValue = String(value);
    if (!FIELD_CONTENT_REGEXP.test(name)) {
      throw new TypeError('argument name is invalid');
    } else if (!FIELD_CONTENT_REGEXP.test(strValue)) {
      throw new TypeError('argument value is invalid');
    } else if (opts.path && !FIELD_CONTENT_REGEXP.test(opts.path)) {
      throw new TypeError('option path is invalid');
    } else if (opts.domain && !FIELD_CONTENT_REGEXP.test(opts.domain)) {
      throw new TypeError('option domain is invalid');
    } else if (opts.sameSite && !SAME_SITE.includes(opts.sameSite)) {
      throw new TypeError('option sameSite is invalid');
    }

    if (!this.#secure && opts.secure) {
      throw new Error('Cannot send secure cookie over unencrypted connection');
    }

    // Create cookie
    const cookie = {
      name,
      value: strValue,
      path: opts.path ?? '/',
      secure: !!opts.secure,
      httpOnly: opts.httpOnly ?? true,
      maxAge: opts.maxAge,
    } as Cookie;

    const signed = opts.signed ?? !!this.#keys;
    if (opts && signed) {
      if (!this.#keys) {
        throw new Error('.keys required for signed cookies');
      }

      cookie.value = this.#keys.sign(`${cookie.name}=${cookie.value}`);
      cookie.name += '.sig';
    }

    // No overwrite allowed (only for currently set headers)
    if (!opts.overwrite && this.has(name)) {
      return this;
    }

    setCookie(this.#res, cookie);
    return super.set(name, cookie.value);
  }

  delete(name: string): boolean {
    if (!FIELD_CONTENT_REGEXP.test(name)) {
      throw new TypeError('argument name is invalid');
    }

    deleteCookie(this.#res, name);
    return super.delete(name);
  }

  clear(): void {
    for (const key of this.keys()) {
      deleteCookie(this.#res, key);
    }
    super.clear();
  }
}

export function middleware(opts?: CookieJarOptions): Middleware {
  return (ctx, next) => {
    ctx.cookies = new CookieJar(ctx, opts);
    return next();
  }
}
