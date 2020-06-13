/*!
 * vary
 * Copyright(c) 2014-2017 Douglas Christopher Wilson
 * MIT Licensed
 */

import { lower } from '../shared.ts';

/**
 * RegExp to match field-name in RFC 7230 sec 3.2
 *
 * field-name    = token
 * token         = 1*tchar
 * tchar         = "!" / "#" / "$" / "%" / "&" / "'" / "*"
 *               / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
 *               / DIGIT / ALPHA
 *               ; any VCHAR, except delimiters
 */
const FIELD_NAME_REGEXP = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function parse(str: string): string[] {
  return str.replace(/ /g, '').split(',');
}

/**
 * Append a field to a vary header.
 */
export function append(header: string, field: string|string[]): string {
  if (typeof header != 'string') {
    throw new TypeError('header argument is required');
  } else if (!field) {
    throw new TypeError('field argument is required');
  }

  // assert on invalid field names
  const fields = Array.isArray(field) ? field : parse(field);
  for (const field of fields) {
    if (!FIELD_NAME_REGEXP.test(field)) {
      throw new TypeError('field argument contains an invalid header name')
    }
  }

  // existing, unspecified vary
  if (header == '*') {
    return header;
  }

  // enumerate current values
  let res: string = '';
  const parsed = parse(lower(header));

  // unspecified vary
  if (fields.includes('*') || parsed.includes('*')) {
    return '*';
  }

  for (let field of fields) {
    field = lower(field);

    // append value (case-preserving)
    if (!parsed.includes(field)) {
      parsed.push(field);
      res += res ? `, ${field}` : field;
    }
  }

  return res;
}

/**
 * Mark that a request is varied on a header field.
 */
export function vary(headers: Headers, field: string|string[]): void {
  if (!headers) {
    // quack quack
    throw new TypeError('headers argument is required');
  }

  // get existing header
  const value = headers.get('Vary') ?? '';
  const header = Array.isArray(value) ? value.join(', ') : value;

  // set new header
  const head = append(header, field);
  if (head) {
    headers.set('Vary', head);
  }
}
