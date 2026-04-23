import { z } from 'zod';

export const CreateInviteBody = z.object({
  note: z.string().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

export interface PublicInvite {
  code: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: { id: string; email: string; username: string } | null;
  note: string | null;
  revokedAt: number | null;
  status: 'pending' | 'used' | 'expired' | 'revoked';
  /** Shareable URL: `${appUrl}/signup?invite=${code}` */
  url: string;
}
