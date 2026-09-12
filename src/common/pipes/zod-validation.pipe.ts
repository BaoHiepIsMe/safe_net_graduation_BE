import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { ValidationError } from '../errors/app.error';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema<any>) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (!this.schema) {
      return value;
    }

    const result = this.schema.safeParse(value);
    if (!result.success) {
      const formattedErrors = this.formatZodError(result.error);
      throw new ValidationError(
        formattedErrors,
        'Dữ liệu đầu vào không hợp lệ',
      );
    }

    return result.data;
  }

  private formatZodError(error: ZodError): Record<string, string[]> {
    const formatted: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || 'root';
      if (!formatted[path]) {
        formatted[path] = [];
      }
      formatted[path].push(issue.message);
    }
    return formatted;
  }
}
