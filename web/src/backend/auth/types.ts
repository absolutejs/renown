import type { TablesRelationalConfig } from "drizzle-orm/relations";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";

export type UserFunctionProps<SchemaType extends TablesRelationalConfig> = {
  authProvider: string;
  db: NeonHttpDatabase<SchemaType>;
  userIdentity: Record<string, unknown>;
};

export type LinkUserIdentityProps<SchemaType extends TablesRelationalConfig> =
  UserFunctionProps<SchemaType> & {
    userSub: string;
  };
