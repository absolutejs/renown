import { NeonHttpDatabase } from "drizzle-orm/neon-http";

export type UserFunctionProps<SchemaType extends Record<string, unknown>> = {
  authProvider: string;
  db: NeonHttpDatabase<SchemaType>;
  userIdentity: Record<string, unknown>;
};

export type LinkUserIdentityProps<SchemaType extends Record<string, unknown>> =
  UserFunctionProps<SchemaType> & {
    userSub: string;
  };
