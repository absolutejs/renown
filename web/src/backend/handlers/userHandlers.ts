import {
  extractPropFromIdentity,
  isValidProviderOption,
  providers,
} from "citra";
import { and, eq, inArray } from "drizzle-orm";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { AuthIdentityConflictError } from "@absolutejs/auth";
import { schema } from "../../../db/schema";
import type {
  AuthIdentity,
  NewAuthIdentity,
  NewAuthIdentityMergeRequest,
  NewUser,
  SchemaType,
} from "../../../db/schema";
import type { LinkUserIdentityProps, UserFunctionProps } from "../auth/types";
import { foldPlayersForMerge } from "../playerAccounts.ts";

type GetDBUserProps = {
  userSub: string;
  db: NeonHttpDatabase<SchemaType>;
};

type CanonicalUserFields = Pick<NewUser, "email" | "first_name" | "last_name">;

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

const extractOptionalProviderString = ({
  userIdentity,
  keys,
}: {
  userIdentity: Record<string, unknown>;
  keys?: string[];
}) => {
  if (!keys || keys.length === 0) {
    return undefined;
  }

  try {
    return normalizeOptionalString(
      extractPropFromIdentity(userIdentity, keys, "string"),
    );
  } catch {
    return undefined;
  }
};

const buildCanonicalUserFieldsFromIdentity = ({
  authProvider,
  userIdentity,
}: {
  authProvider: string;
  userIdentity: Record<string, unknown>;
}): CanonicalUserFields => {
  if (!isValidProviderOption(authProvider)) {
    throw new Error(`Invalid auth provider: ${authProvider}`);
  }

  const providerConfiguration = providers[authProvider];
  const fullName = extractOptionalProviderString({
    keys: providerConfiguration.fullName,
    userIdentity,
  });
  const fullNameParts = fullName?.split(/\s+/).filter(Boolean) ?? [];
  const [fallbackFirstName] = fullNameParts;
  const fallbackLastName =
    fullNameParts.length > 1 ? fullNameParts.slice(1).join(" ") : undefined;

  return {
    email:
      extractOptionalProviderString({
        keys: providerConfiguration.email,
        userIdentity,
      })?.toLowerCase() ?? null,
    first_name:
      extractOptionalProviderString({
        keys: providerConfiguration.givenName,
        userIdentity,
      }) ??
      fallbackFirstName ??
      null,
    last_name:
      extractOptionalProviderString({
        keys: providerConfiguration.familyName,
        userIdentity,
      }) ??
      fallbackLastName ??
      null,
  };
};
const createDBUser = async ({
  sub,
  db,
  email,
  first_name,
  last_name,
  primary_auth_identity_id,
}: NewUser & { db: NeonHttpDatabase<SchemaType> }) => {
  const [newUser] = await db
    .insert(schema.users)
    .values({
      email,
      first_name,
      last_name,
      primary_auth_identity_id,
      sub,
    })
    .returning();

  return newUser;
};
export const getDBUser = async ({ userSub, db }: GetDBUserProps) => {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.sub, userSub))
    .execute();

  return user;
};
type UpdateDBUserProps = {
  userSub: string;
  db: NeonHttpDatabase<SchemaType>;
  fields: Partial<NewUser>;
};

const updateDBUser = async ({
  userSub,
  db,
  fields,
}: UpdateDBUserProps) => {
  const [user] = await db
    .update(schema.users)
    .set(fields)
    .where(eq(schema.users.sub, userSub))
    .returning();

  return user;
};
type UpdateDBUserPrimaryAuthIdentityProps = {
  userSub: string;
  db: NeonHttpDatabase<SchemaType>;
  primaryAuthIdentityId: string;
};

const updateDBUserPrimaryAuthIdentity = async ({
  userSub,
  db,
  primaryAuthIdentityId,
}: UpdateDBUserPrimaryAuthIdentityProps) =>
  updateDBUser({
    db,
    fields: { primary_auth_identity_id: primaryAuthIdentityId },
    userSub,
  });

const createIdentityId = ({
  authProvider,
  providerSubject,
}: {
  authProvider: string;
  providerSubject: string;
}) => `${authProvider}:${providerSubject}`;

const createAccountId = () => crypto.randomUUID();

type CreateMergeRequestIdProps = {
  sourceUserSub: string;
  targetUserSub: string;
  authProvider: string;
  providerSubject: string;
};

const createMergeRequestId = ({
  sourceUserSub,
  targetUserSub,
  authProvider,
  providerSubject,
}: CreateMergeRequestIdProps) =>
  `merge:${targetUserSub}:${sourceUserSub}:${authProvider}:${providerSubject}`;

const buildProviderSubjectFromIdentity = ({
  authProvider,
  userIdentity,
}: {
  authProvider: string;
  userIdentity: Record<string, unknown>;
}) => {
  if (!isValidProviderOption(authProvider)) {
    throw new Error(`Invalid auth provider: ${authProvider}`);
  }

  const providerConfiguration = providers[authProvider];

  return String(
    extractPropFromIdentity(
      userIdentity,
      providerConfiguration.subject,
      providerConfiguration.subjectType,
    ),
  );
};

const createDBAuthIdentity = async ({
  auth_provider,
  db,
  id,
  metadata,
  provider_subject,
  user_sub,
}: NewAuthIdentity & { db: NeonHttpDatabase<SchemaType> }) => {
  const [identity] = await db
    .insert(schema.authIdentities)
    .values({
      auth_provider,
      id,
      metadata,
      provider_subject,
      user_sub,
    })
    .returning();

  return identity;
};

type GetDBAuthIdentityProps = {
  authProvider: string;
  db: NeonHttpDatabase<SchemaType>;
  providerSubject: string;
};

const createDBAuthIdentityMergeRequest = async ({
  db,
  ...values
}: NewAuthIdentityMergeRequest & { db: NeonHttpDatabase<SchemaType> }) => {
  const [request] = await db
    .insert(schema.authIdentityMergeRequests)
    .values(values)
    .returning();

  return request;
};
const getDBAuthIdentity = async ({
  authProvider,
  db,
  providerSubject,
}: GetDBAuthIdentityProps) => {
  const [identity] = await db
    .select()
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.auth_provider, authProvider),
        eq(schema.authIdentities.provider_subject, providerSubject),
      ),
    )
    .execute();

  return identity;
};
const getDBAuthIdentityById = async ({
  db,
  id,
}: {
  db: NeonHttpDatabase<SchemaType>;
  id: string;
}) => {
  const [identity] = await db
    .select()
    .from(schema.authIdentities)
    .where(eq(schema.authIdentities.id, id))
    .execute();

  return identity;
};
const getDBAuthIdentityMergeRequest = async ({
  db,
  id,
}: {
  db: NeonHttpDatabase<SchemaType>;
  id: string;
}) => {
  const [request] = await db
    .select()
    .from(schema.authIdentityMergeRequests)
    .where(eq(schema.authIdentityMergeRequests.id, id))
    .execute();

  return request;
};
export const listDBAuthIdentitiesByUser = async ({
  db,
  userSub,
}: {
  db: NeonHttpDatabase<SchemaType>;
  userSub: string;
}) =>
  db
    .select()
    .from(schema.authIdentities)
    .where(eq(schema.authIdentities.user_sub, userSub))
    .execute();
export const listDBAuthIdentityMergeRequestsByTarget = async ({
  db,
  targetUserSub,
}: {
  db: NeonHttpDatabase<SchemaType>;
  targetUserSub: string;
}) =>
  db
    .select()
    .from(schema.authIdentityMergeRequests)
    .where(eq(schema.authIdentityMergeRequests.target_user_sub, targetUserSub))
    .execute();
export const removeDBAuthIdentity = async ({
  db,
  id,
}: {
  db: NeonHttpDatabase<SchemaType>;
  id: string;
}) => {
  await db
    .delete(schema.authIdentities)
    .where(eq(schema.authIdentities.id, id));
};

type UpsertDBAuthIdentityMergeRequestProps = {
  authProvider: string;
  db: NeonHttpDatabase<SchemaType>;
  metadata?: Record<string, unknown>;
  providerSubject: string;
  sourceUserSub: string;
  targetUserSub: string;
};

export const upsertDBAuthIdentityMergeRequest = async ({
  authProvider,
  db,
  metadata,
  providerSubject,
  sourceUserSub,
  targetUserSub,
}: UpsertDBAuthIdentityMergeRequestProps) => {
  const id = createMergeRequestId({
    authProvider,
    providerSubject,
    sourceUserSub,
    targetUserSub,
  });
  const existing = await getDBAuthIdentityMergeRequest({ db, id });
  if (existing !== undefined) {
    const [updated] = await db
      .update(schema.authIdentityMergeRequests)
      .set({
        metadata: metadata ?? existing.metadata,
        status: "pending",
        updated_at: new Date(),
      })
      .where(eq(schema.authIdentityMergeRequests.id, id))
      .returning();

    return updated;
  }

  return createDBAuthIdentityMergeRequest({
    conflicting_auth_provider: authProvider,
    conflicting_provider_subject: providerSubject,
    db,
    id,
    metadata,
    source_user_sub: sourceUserSub,
    status: "pending",
    target_user_sub: targetUserSub,
  });
};

type UpdateDBAuthIdentityMergeRequestStatusProps = {
  db: NeonHttpDatabase<SchemaType>;
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
};

export const deleteDBAuthIdentityMergeRequest = async ({
  db,
  id,
}: {
  db: NeonHttpDatabase<SchemaType>;
  id: string;
}) => {
  await db
    .delete(schema.authIdentityMergeRequests)
    .where(eq(schema.authIdentityMergeRequests.id, id));
};
export const linkUserIdentity = async ({
  authProvider,
  db,
  userSub,
  userIdentity,
}: LinkUserIdentityProps<SchemaType>): Promise<{
  identity: AuthIdentity;
  status: "already_linked" | "created";
}> => {
  const providerSubject = buildProviderSubjectFromIdentity({
    authProvider,
    userIdentity,
  });
  const existingIdentity = await getDBAuthIdentity({
    authProvider,
    db,
    providerSubject,
  });

  if (existingIdentity !== undefined && existingIdentity.user_sub !== userSub) {
    throw new AuthIdentityConflictError({
      authProvider,
      currentUserAuthSub: userSub,
      existingUserAuthSub: existingIdentity.user_sub,
      providerSubject,
    });
  }

  if (existingIdentity !== undefined) {
    return {
      identity: existingIdentity,
      status: "already_linked" as const,
    };
  }

  const identity = await createDBAuthIdentity({
    auth_provider: authProvider,
    db,
    id: createIdentityId({ authProvider, providerSubject }),
    metadata: userIdentity,
    provider_subject: providerSubject,
    user_sub: userSub,
  });

  if (identity === undefined) {
    throw new Error("Failed to create auth identity");
  }

  return {
    identity,
    status: "created" as const,
  };
};
const updateDBAuthIdentityMergeRequestStatus = async ({
  db,
  id,
  status,
  metadata,
}: UpdateDBAuthIdentityMergeRequestStatusProps) => {
  const [request] = await db
    .update(schema.authIdentityMergeRequests)
    .set({
      metadata,
      status,
      updated_at: new Date(),
    })
    .where(eq(schema.authIdentityMergeRequests.id, id))
    .returning();

  return request;
};

type SetPrimaryAuthIdentityProps = {
  db: NeonHttpDatabase<SchemaType>;
  identityId: string;
  userSub: string;
};

export const setPrimaryAuthIdentity = async ({
  db,
  identityId,
  userSub,
}: SetPrimaryAuthIdentityProps) => {
  const identity = await getDBAuthIdentityById({ db, id: identityId });
  if (identity === undefined || identity.user_sub !== userSub) {
    throw new Error("Auth identity not found");
  }

  await updateDBUser({
    db,
    fields: {
      primary_auth_identity_id: identity.id,
      ...buildCanonicalUserFieldsFromIdentity({
        authProvider: identity.auth_provider,
        userIdentity: identity.metadata ?? {},
      }),
    },
    userSub,
  });

  return identity;
};

type MergeUserAccountsProps = {
  db: NeonHttpDatabase<SchemaType>;
  mergeRequestId: string;
  targetUserSub: string;
};

export const createUser = async ({
  userIdentity,
  authProvider,
  db,
}: UserFunctionProps<SchemaType>) => {
  const userSub = createAccountId();

  const user = await createDBUser({
    db,
    primary_auth_identity_id: null,
    sub: userSub,
    ...buildCanonicalUserFieldsFromIdentity({
      authProvider,
      userIdentity,
    }),
  });

  const linkedIdentity = await linkUserIdentity({
    authProvider,
    db,
    userIdentity,
    userSub,
  });

  await updateDBUserPrimaryAuthIdentity({
    db,
    primaryAuthIdentityId: linkedIdentity.identity.id,
    userSub,
  });

  return getDBUser({ db, userSub }) ?? user;
};
export const getUser = async ({
  userIdentity,
  authProvider,
  db,
}: UserFunctionProps<SchemaType>) => {
  const providerSubject = buildProviderSubjectFromIdentity({
    authProvider,
    userIdentity,
  });
  const identity = await getDBAuthIdentity({
    authProvider,
    db,
    providerSubject,
  });

  if (identity !== undefined) {
    return getDBUser({ db, userSub: identity.user_sub });
  }

  return undefined;
};
export const mergeUserAccounts = async ({
  db,
  mergeRequestId,
  targetUserSub,
}: MergeUserAccountsProps) => {
  const mergeRequest = await getDBAuthIdentityMergeRequest({
    db,
    id: mergeRequestId,
  });
  if (
    mergeRequest === undefined ||
    mergeRequest.target_user_sub !== targetUserSub ||
    mergeRequest.status !== "pending"
  ) {
    throw new Error("Merge request not found");
  }

  const [targetUser, sourceUser] = await Promise.all([
    getDBUser({ db, userSub: targetUserSub }),
    getDBUser({ db, userSub: mergeRequest.source_user_sub }),
  ]);
  if (targetUser === undefined || sourceUser === undefined) {
    throw new Error("Merge users not found");
  }

  const [targetIdentities, sourceIdentities] = await Promise.all([
    listDBAuthIdentitiesByUser({ db, userSub: targetUserSub }),
    listDBAuthIdentitiesByUser({
      db,
      userSub: mergeRequest.source_user_sub,
    }),
  ]);
  const targetKeys = new Set(
    targetIdentities.map(
      (identity) => `${identity.auth_provider}:${identity.provider_subject}`,
    ),
  );
  const conflictingIdentity = `${mergeRequest.conflicting_auth_provider}:${mergeRequest.conflicting_provider_subject}`;
  const duplicate = sourceIdentities.find((identity) => {
    const key = `${identity.auth_provider}:${identity.provider_subject}`;

    return key !== conflictingIdentity && targetKeys.has(key);
  });
  if (duplicate) {
    throw new Error(
      `Cannot merge accounts because ${duplicate.auth_provider}:${duplicate.provider_subject} is already linked to both users`,
    );
  }

  if (sourceIdentities.length > 0) {
    await db
      .update(schema.authIdentities)
      .set({ updated_at: new Date(), user_sub: targetUserSub })
      .where(
        inArray(
          schema.authIdentities.id,
          sourceIdentities.map((identity) => identity.id),
        ),
      );
  }

  await db
    .update(schema.linkedProviderGrants)
    .set({ owner_ref: targetUserSub, updated_at: new Date() })
    .where(
      eq(schema.linkedProviderGrants.owner_ref, mergeRequest.source_user_sub),
    );

  // Fold the source user's GAME player (pets/scores/accounts/achievements) into the target's
  // before the source user row goes away. Auth identities have already moved above, so the
  // target now owns the conflicting github; the player rollup reflects both.
  await foldPlayersForMerge({ sourceUserSub: mergeRequest.source_user_sub, targetUserSub });

  await db
    .delete(schema.users)
    .where(eq(schema.users.sub, mergeRequest.source_user_sub));

  await updateDBAuthIdentityMergeRequestStatus({
    db,
    id: mergeRequest.id,
    metadata: {
      mergedInto: targetUserSub,
      mergedSource: mergeRequest.source_user_sub,
    },
    status: "merged",
  });

  return mergeRequest;
};
