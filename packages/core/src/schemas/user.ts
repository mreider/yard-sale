import { z } from 'zod';

export const UpdateMeBody = z.object({
  defaultLanguage: z.string().min(2).max(8).optional(),
  defaultTheme: z.enum(['conservative', 'artsy', 'hip', 'retro']).optional(),
  displayName: z.string().max(100).optional(),
  profilePublic: z.boolean().optional(),
  defaultRegion: z
    .object({
      country: z.string().length(2),
      city: z.string().optional(),
    })
    .optional(),
});
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(256),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

// Self-serve account deletion. Confirmation phrase is required to make
// it harder to fat-finger; current password gates against session
// hijack quietly nuking everything.
export const DeleteMeBody = z.object({
  currentPassword: z.string().min(1),
  confirmation: z.literal('DELETE'),
});
export type DeleteMeBody = z.infer<typeof DeleteMeBody>;

export interface UserPublic {
  id: string;
  email: string;
  emailConfirmed: boolean;
  username: string;
  avatarUrl: string | null;
  defaultLanguage: string;
  defaultTheme: string;
  createdAt: number;
  displayName?: string;
  profilePublic: boolean;
  defaultRegion?: { country: string; city?: string };
}
