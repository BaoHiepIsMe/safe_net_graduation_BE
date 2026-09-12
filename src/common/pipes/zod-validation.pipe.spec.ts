import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { ValidationError } from '../errors/app.error';

describe('ZodValidationPipe', () => {
  const testSchema = z.object({
    name: z.string().min(3),
    age: z.number().int().positive(),
  });

  let pipe: ZodValidationPipe;

  beforeEach(() => {
    pipe = new ZodValidationPipe(testSchema);
  });

  it('should transform and return valid data', () => {
    const validData = { name: 'Alice', age: 25 };
    const result = pipe.transform(validData, { type: 'body' });
    expect(result).toEqual(validData);
  });

  it('should throw ValidationError on invalid input', () => {
    const invalidData = { name: 'Al', age: -5 };
    expect(() => pipe.transform(invalidData, { type: 'body' })).toThrow(
      ValidationError,
    );
  });
});
