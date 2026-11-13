import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Error con un código que la app entiende (por ejemplo, pedir el código del correo). */
export class CodedError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    message: string,
    public code: string,
  ) {
    super(status, { message });
  }
}
