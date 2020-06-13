import { path } from './deps.ts';
import { decodeURIComponent } from './shared.ts';
import { Context } from './ctx.ts';

const NOT_FOUND = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR'];

export interface SendOptions {
  maxAge?: number;
  immutable?: boolean
  hidden?: boolean;
  root?: string;
  index?: string;
  gzip?: boolean;
  brotli?: boolean;
  format?: boolean;
  setHeaders?(headers: Headers, path: string, stats: Deno.FileInfo): void;
  extensions?: string[];
}

/**
 * Send file at `path` with the
 * given `options` to the koa `ctx`.
 */
export async function send(ctx: Context, filename: string, opts: SendOptions = {}): Promise<string|void> {
  const { index, setHeaders } = opts;
  const root = opts.root ? path.normalize(path.resolve(opts.root)) : '';
  const trailingSlash = filename[filename.length - 1] == '/';
  const maxAge = opts.maxAge ?? 0;
  const immutable = opts.immutable ?? false;
  const hidden = opts.hidden ?? false;
  const format = opts.format !== false;
  const extensions = Array.isArray(opts.extensions) ? opts.extensions : null;
  const brotli = opts.brotli !== false;
  const gzip = opts.gzip !== false;
  let ext = '';
  filename = filename.substring(path.parse(filename).root.length);

  if (setHeaders && typeof setHeaders != 'function') {
    throw new TypeError('option setHeaders must be function');
  }

  // normalize path
  const decoded = decodeURIComponent(filename);

  if (decoded == null) {
    ctx.throw(400, 'failed to decode');
  }

  // index file support
  filename = decoded;
  if (index && trailingSlash) {
    filename += index;
  }

  filename = path.resolve(root, filename);

  // hidden file support, ignore
  if (!hidden && isHidden(root, filename)) {
    return;
  }

  // serve brotli file when possible otherwise gzipped file when possible
  if (brotli && ctx.acceptsEncodings('br', 'identity') == 'br' && (await exists(`${filename}.br`))) {
    filename += '.br'
    ctx.set('Content-Encoding', 'br'),
    ctx.remove('Content-Length'),
    ext = '.br';
  } else if (gzip && ctx.acceptsEncodings('gzip', 'identity') == 'gzip' && (await exists(`${filename}.gz`))) {
    filename += '.gz';
    ctx.set('Content-Encoding', 'gzip');
    ctx.remove('Content-Length');
    ext = '.gz';
  }

  // Path doesn't have extension
  if (extensions && !path.basename(filename).includes('.')) {
    for (let ext of extensions) {
      if (typeof ext != 'string') {
        throw new TypeError('option extensions must be array of strings');
      }

      if (ext[0] != '.') {
        ext = `.${ext}`;
      }

      if (await exists(`${filename}${ext}`)) {
        filename = `${filename}${ext}`;
        break;
      }
    }
  }

  // stat
  let stats: Deno.FileInfo;
  try {
    stats = await Deno.stat(filename);

    // Format the path to serve static file servers
    // and not require a trailing slash for directories,
    // so that you can do both `/directory` and `/directory/`
    if (stats.isDirectory) {
      if (format && index) {
        filename += `/${index}`;
        stats = await Deno.stat(filename);
      } else {
        return;
      }
    }
  } catch (ex) {
    const status = NOT_FOUND.includes(ex.code) ? 404 : 500;
    ctx.throw(status, ex.message);
  }

  // Set headers
  if (setHeaders) {
    setHeaders(ctx.res.headers, filename, stats);
  }

  ctx.set('Content-Length', `${stats.size}`);
  if (stats.mtime && !ctx.has('Last-Modified')) {
    ctx.set('Last-Modified', stats.mtime.toUTCString());
  }
  if (!ctx.has('Cache-Control')) {
    const cache = `max-age=${(maxAge / 1000 | 0)}${immutable ? ',immutable' : ''}`;
    ctx.set('Cache-Control', cache);
  }
  if (!ctx.type) {
    ctx.type = ext ? path.extname(path.basename(filename, ext)) : path.extname(filename);
  }

  // Open file as stream and close when finished
  const file = await Deno.open(filename, { read: true });
  ctx.body = file;
  ctx.response.etagEntity = stats;
  ctx.req.done.then(() => file.close());
  return filename;
}

/**
 * Check if it's hidden.
 */
function isHidden(root: string, filename: string): boolean {
  return filename.substring(root.length)[0] == '.';
    /*.substring(root.length)
    .split(sep)
    .some(p => p[0] == '.');*/
}

// Nabbed from Deno std/path
async function exists(filename: string): Promise<boolean> {
  try {
    await Deno.lstat(filename);
    return true;
  } catch (ex) {
    if (ex instanceof Deno.errors.NotFound) {
      return false;
    }

    throw ex;
  }
}
