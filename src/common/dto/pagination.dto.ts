import { z } from 'zod';

export const pagePaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PagePaginationDto = z.infer<typeof pagePaginationSchema>;

export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().uuid().optional(),
});

export type CursorPaginationDto = z.infer<typeof cursorPaginationSchema>;
