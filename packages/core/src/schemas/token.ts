import { z } from 'zod';

export const TokenScope = z.enum(['read', 'write', 'admin']);
export type TokenScope = z.infer<typeof TokenScope>;

export const TokenExpiry = z.enum(['none', '30d', '90d', '1y']);
export type TokenExpiry = z.infer<typeof TokenExpiry>;

export const CreateTokenBody = z.object({
  name: z.string().min(1).max(80),
  scope: TokenScope,
  expiry: TokenExpiry.default('none'),
});
export type CreateTokenBody = z.infer<typeof CreateTokenBody>;

export interface TokenPublic {
  id: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  expiresAt: number | null;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  createdAt: number;
}
