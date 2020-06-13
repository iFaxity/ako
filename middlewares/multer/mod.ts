import { FormFile, MultipartReader, MultipartFormData } from 'https://deno.land/std@v0.57.0/mime/multipart.ts';
import * as contentType from 'https://deno.land/x/content_type/mod.ts';
import { Middleware, Context } from '../../app.ts';

declare module '../../app.ts' {
  interface Context {
    file: string;
    files: string[];
  }
}

interface MulterOptions {
  dest: string;
  fileFilter?: object;
  limits?: object;
  preservePath?: string;
}

interface MulterField {
  name: string;
  maxCount: number;
}

interface Multer {
  single(fieldname: string): Middleware;
  array(fieldname: string, maxCount?: number): Middleware;
  fields(fields: MulterField[]): Middleware;
  none(): Middleware;
  any(): Middleware;
}

function parseBoundary(ctx: Context): string|boolean|null {
  // empty body
  if (!ctx.length) {
    return false;
  }

  const header = ctx.req.headers.get('Content-Type');
  if (header) {
    const { parameters, type } = contentType.parse(header);

    if (type == 'multipart/form-data') {
      return parameters?.boundary ?? null;
    }
  }
  return null;
}

async function readData(ctx: Context): Promise<MultipartFormData|void> {
  const boundary = parseBoundary(ctx);
  if (typeof boundary == 'string') {
    const data = new MultipartReader(ctx.req.body, boundary);
    return data.readForm();
  } else if (typeof boundary != 'boolean') {
    throw new Error('boundrary invalid');
  }
}

export default function multer(opts: MulterOptions): Multer {
  const { dest } = opts;

  return {
    single(field) {
      return async (ctx, next) => {
        const data = await readData(ctx);
        if (!data) {
          return next();
        }

        return next();
      };
    },
    array(field: string, maxCount?: number) {
      return (ctx, next) => {};
    },
    fields(fields: MulterField[]) {
      return (ctx, next) => {};
    },
    none() {
      return async (ctx, next) => {
        const data = await readData(ctx);
        if (!data) {
          return next();
        }

        let body = {} as Record<string, string>;
        data.entries();
        for (const [ key, file ] of data.entries()) {
          if (typeof file == 'string') {
            body[key] = file;
          } else {
            throw new Error('File not allowed');
          }
        }

        await next();
        data.removeAll();
      };
    },
    any() {
      return (ctx, next) => {};
    },
  };
}
