/*!
 * content-disposition
 * Copyright(c) 2014-2017 Douglas Christopher Wilson
 * MIT Licensed
 */
import { path, contentType } from '../deps.ts';
import { quoteString, upper, lower } from '../shared.ts';

/**
 * RegExp to match non attr-char, *after* encodeURIComponent (i.e. not including "%")
 */
const ENCODE_URL_ATTR_CHAR_REGEXP = /[\x00-\x20"'()*,/:;<=>?@[\\\]{}\x7f]/g;

/**
 * RegExp to match percent encoding escape.
 */
const HEX_ESCAPE_REGEXP = /%[0-9A-Fa-f]{2}/;
const HEX_ESCAPE_REPLACE_REGEXP = /%([0-9A-Fa-f]{2})/g;

/**
 * RegExp to match non-latin1 characters.
 */
const NON_LATIN1_REGEXP = /[^\x20-\x7e\xa0-\xff]/g;

/**
 * RegExp to match quoted-pair in RFC 2616
 *
 * quoted-pair = "\" CHAR
 * CHAR        = <any US-ASCII character (octets 0 - 127)>
 */
const QESC_REGEXP = /\\([\u0000-\u007f])/g;

/**
 * RegExp for various RFC 2616 grammar
 *
 * parameter     = token "=" ( token | quoted-string )
 * token         = 1*<any CHAR except CTLs or separators>
 * separators    = "(" | ")" | "<" | ">" | "@"
 *               | "," | ";" | ":" | "\" | <">
 *               | "/" | "[" | "]" | "?" | "="
 *               | "{" | "}" | SP | HT
 * quoted-string = ( <"> *(qdtext | quoted-pair ) <"> )
 * qdtext        = <any TEXT except <">>
 * quoted-pair   = "\" CHAR
 * CHAR          = <any US-ASCII character (octets 0 - 127)>
 * TEXT          = <any OCTET except CTLs, but including LWS>
 * LWS           = [CRLF] 1*( SP | HT )
 * CRLF          = CR LF
 * CR            = <US-ASCII CR, carriage return (13)>
 * LF            = <US-ASCII LF, linefeed (10)>
 * SP            = <US-ASCII SP, space (32)>
 * HT            = <US-ASCII HT, horizontal-tab (9)>
 * CTL           = <any US-ASCII control character (octets 0 - 31) and DEL (127)>
 * OCTET         = <any 8-bit sequence of data>
 */
const PARAM_REGEXP = /;[\x09\x20]*([!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*=[\x09\x20]*("(?:[\x20!\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\x20-\x7e])*"|[!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*/g;
const TEXT_REGEXP = /^[\x20-\x7e\x80-\xff]+$/;
const TOKEN_REGEXP = /^[!#$%&'*+.0-9A-Z^_`a-z|~-]+$/;

/**
 * RegExp for various RFC 5987 grammar
 *
 * ext-value     = charset  "'" [ language ] "'" value-chars
 * charset       = "UTF-8" / "ISO-8859-1" / mime-charset
 * mime-charset  = 1*mime-charsetc
 * mime-charsetc = ALPHA / DIGIT
 *               / "!" / "#" / "$" / "%" / "&"
 *               / "+" / "-" / "^" / "_" / "`"
 *               / "{" / "}" / "~"
 * language      = ( 2*3ALPHA [ extlang ] )
 *               / 4ALPHA
 *               / 5*8ALPHA
 * extlang       = *3( "-" 3ALPHA )
 * value-chars   = *( pct-encoded / attr-char )
 * pct-encoded   = "%" HEXDIG HEXDIG
 * attr-char     = ALPHA / DIGIT
 *               / "!" / "#" / "$" / "&" / "+" / "-" / "."
 *               / "^" / "_" / "`" / "|" / "~"
 */
const EXT_VALUE_REGEXP = /^([A-Za-z0-9!#$%&+\-^_`{}~]+)'(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8}|)'((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9!#$&+.^_`|~-])+)$/;

/**
 * RegExp for various RFC 6266 grammar
 *
 * disposition-type = "inline" | "attachment" | disp-ext-type
 * disp-ext-type    = token
 * disposition-parm = filename-parm | disp-ext-parm
 * filename-parm    = "filename" "=" value
 *                  | "filename*" "=" ext-value
 * disp-ext-parm    = token "=" value
 *                  | ext-token "=" ext-value
 * ext-token        = <the characters in token, followed by "*">
 */
const DISPOSITION_TYPE_REGEXP = /^([!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*(?:$|;)/;

export interface ContentDispositionOptions {
  type?: string;
  fallback?: string;
}

/**
 * Create an attachment Content-Disposition header.
 */
export function contentDisposition(filename?: string, opts: ContentDispositionOptions = {}): string {
  if (opts.type && (typeof opts.type != 'string' || !TOKEN_REGEXP.test(opts.type))) {
    throw new TypeError('invalid type');
  }

  // format mediaType into header
  const params = createParams(filename, opts.fallback);
  let header = opts.type ? lower(opts.type) : 'attachment';

  // append parameters
  if (params) {
    for (const key of Object.keys(params).sort()) {
      const param = params[key];
      const value = key[key.length - 1] == '*' ? ustring(param) : quoteString(param);

      header += `; ${key}=${value}`;
    }
  }

  return header;
}

/**
 * Parse Content-Disposition header string.
 */
export function parse(header: string): contentType.ContentType {
  if (!header || typeof header != 'string') {
    throw new TypeError('argument string is required');
  }

  let match = DISPOSITION_TYPE_REGEXP.exec(header);
  if (!match) {
    throw new TypeError('invalid type format')
  }

  // normalize type
  const name = match[0];
  const type = lower(match[1]);
  let idx = name.length;
  let names: string[] = [];
  let parameters = {} as Record<string, string>;

  // calculate index to start at
  idx = PARAM_REGEXP.lastIndex = name.endsWith(';') ? idx - 1 : idx;

  // match parameters
  while (match = PARAM_REGEXP.exec(header)) {
    if (match.index != idx) {
      throw new TypeError('invalid parameter format');
    }

    idx += match[0].length;
    let key = lower(match[1]);
    let value = match[2];

    if (!names.includes(key)) {
      throw new TypeError('invalid duplicate parameter');
    }
    names.push(key);

    if (key.indexOf('*') == key.length - 1) {
      // decode extended value
      key = key.slice(0, -1);
      // overwrite existing value
      parameters[key] = decodeField(value);
    } else if (typeof parameters[key] != 'string') {
      if (value[0] == '"') {
        // trim quotes and escapes
        value = value.substring(1, value.length - 1).replace(QESC_REGEXP, '$1');
      }

      parameters[key] = value;
    }
  }

  if (idx != -1 && idx != header.length) {
    throw new TypeError('invalid parameter format');
  }

  return { type, parameters };
}

/**
 * Create parameters object from filename and fallback.
 */
function createParams(filename?: string, fallback?: string): Record<string, string>|null {
  if (!filename) {
    return null;
  }

  const params = {} as Record<string, string>;
  if (typeof filename != 'string') {
    throw new TypeError('filename must be a string');
  } else if (typeof fallback != 'string') {
    throw new TypeError('fallback must be a string');
  } else if (NON_LATIN1_REGEXP.test(fallback)) {
    throw new TypeError('fallback must be ISO-8859-1 string');
  }

  // restrict to file base name
  const name = path.basename(filename);
  // determine if name is suitable for quoted string
  const isQuoted = TEXT_REGEXP.test(name);

  // generate fallback name
  const fallbackName = !fallback ? getlatin1(name) : path.basename(fallback);
  const hasFallback = fallbackName != name;

  // set extended filename parameter
  if (hasFallback || !isQuoted || HEX_ESCAPE_REGEXP.test(name)) {
    params['filename*'] = name;
  }

  // set filename parameter
  if (isQuoted || hasFallback) {
    params.filename = hasFallback ? fallbackName : name;
  }
  return params;
}

/**
 * Decode a RFC 6987 field value (gracefully).
 */
function decodeField(str: string): string {
  const match = EXT_VALUE_REGEXP.exec(str)
  if (!match) {
    throw new TypeError('invalid extended field value')
  }

  const charset = lower(match[1]);
  const encoded = match[2];

  // to binary string
  const binary = encoded.replace(HEX_ESCAPE_REPLACE_REGEXP, pdecode);
  if (charset == 'iso-8859-1') {
    return getlatin1(binary);
  } else if (charset == 'utf-8') {
    return binary;
  }

  throw new TypeError('unsupported charset in extended field');
}

/**
 * Get ISO-8859-1 version of string.
 */
function getlatin1(value: string): string {
  // simple Unicode -> ISO-8859-1 transformation
  return value.replace(NON_LATIN1_REGEXP, '?');
}

/**
 * Percent decode a single character.
 */
function pdecode(_: string, hex: string) {
  return String.fromCharCode(parseInt(hex, 16));
}

/**
 * Percent encode a single character.
 */
function pencode(char: string): string {
  const c = upper(char.charCodeAt(0).toString(16));
  return `%${c}`;
}

/**
 * Encode a Unicode string for HTTP (RFC 5987).
 */
function ustring(value: string): string {
  // percent encode as UTF-8
  const encoded = encodeURIComponent(value)
    .replace(ENCODE_URL_ATTR_CHAR_REGEXP, pencode);

  return `UTF-8''${encoded}`;
}
