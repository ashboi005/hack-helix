import type { user } from "@/db/schema";

export type UserRow = typeof user.$inferSelect;

export type UserResponse = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
};

export type UserProfileChanges = Partial<Pick<UserRow, "name" | "image">>;
