import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { issuanceRecoverySql } from '../db/issuance-recovery.ts';

const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    CREATE TABLE attribution_commits(player_id text,github_login text,sha text,discovered_at timestamp DEFAULT now(),PRIMARY KEY(player_id,github_login,sha));
    CREATE TABLE pet_subjects(id text PRIMARY KEY,subject_seed text);
    CREATE TABLE pet_printings(id text PRIMARY KEY,subject_id text,set_id text,variant text,print_run integer,serial_offset integer,serial_step integer,issued integer DEFAULT 0);
    CREATE TABLE wild_seed_sources(player_id text,pet_seed text UNIQUE,github_login text,provenance_seed text,printing_id text,serial_number integer,print_run integer,mint_number integer,variant text,finish text,recipe_version text,earned_at timestamp DEFAULT now());
    CREATE TABLE pet_ownership_events(id text PRIMARY KEY,pet_seed text,sequence integer,kind text,to_player_id text,reason text,chain_ref text,occurred_at timestamp,UNIQUE(pet_seed,sequence));
    INSERT INTO pet_subjects VALUES ('subject','subject-seed');
  `);
  // Exercise the actual production allocator, not a rewritten imitation.
  const source = await Bun.file(new URL('../db/migrate-serialized-pets.ts', import.meta.url)).text();
  const allocator = source.match(/await sql`(create or replace function issue_pet_copy\([\s\S]*?end \$\$)`;/)?.[1];
  if (!allocator) throw new Error('production allocator SQL not found');
  await db.exec(allocator);
  const market = await Bun.file(new URL('../db/migrate-marketplace.ts', import.meta.url)).text();
  const protection = market.match(/await sql`(create or replace function protect_ownership_event\([\s\S]*?end \$\$)`;/)?.[1];
  if (!protection) throw new Error('production ownership protection SQL not found');
  await db.exec(protection);
  await db.exec(`CREATE TRIGGER ownership_events_immutable BEFORE UPDATE OR DELETE ON pet_ownership_events FOR EACH ROW EXECUTE FUNCTION protect_ownership_event()`);
  await db.exec(issuanceRecoverySql);
  await db.exec(issuanceRecoverySql); // Repeat deployment is safe.
}, 30000);
afterAll(async () => { await db.close(); });

const contribute = async (player: string, sha: string) => db.query('INSERT INTO attribution_commits(player_id,github_login,sha) VALUES ($1,$1,$2)',[player,sha]);
const issue = (player: string, sha: string, token: string, printing=sha, run=500) => db.query<{out_pet_seed:string;out_created:boolean}>(
  `SELECT * FROM issue_pending_pet_copy($1,$1,$2,'subject','subject-seed','Test','set','rare',$3,$4,0,1,'Holo','genesis-v2','card:v2:set:subject:rare',$5)`,[player,sha,printing,run,token]);

test('retry after transfer keeps the original copy and original earner', async () => {
  await contribute('alice','commit-a');
  const first=(await issue('alice','commit-a','token-a')).rows[0]!;
  await db.query("UPDATE wild_seed_sources SET player_id='bob' WHERE pet_seed=$1",[first.out_pet_seed]);
  const retry=(await issue('alice','commit-a','token-a')).rows[0]!;
  expect(retry).toMatchObject({out_pet_seed:first.out_pet_seed,out_created:false});
  expect((await db.query<{issued:number}>("SELECT issued FROM pet_printings WHERE id='commit-a'")).rows[0]!.issued).toBe(1);
  expect((await db.query<{to_player_id:string}>('SELECT to_player_id FROM pet_ownership_events WHERE pet_seed=$1',[first.out_pet_seed])).rows[0]!.to_player_id).toBe('alice');
});

test('a recorded contribution survives a failed issuance and can be retried', async () => {
  await contribute('carol','commit-b');
  await expect(db.query(`SELECT * FROM issue_pending_pet_copy('carol','carol','commit-b','missing','subject-seed','Test','set','rare','commit-b',500,0,1,'Holo','genesis-v2','card:v2:set:subject:rare','token-b')`)).rejects.toThrow();
  expect((await db.query<{issued_pet_seed:string|null}>("SELECT issued_pet_seed FROM attribution_commits WHERE sha='commit-b'")).rows[0]!.issued_pet_seed).toBeNull();
  expect((await issue('carol','commit-b','token-b')).rows[0]!.out_created).toBe(true);
});

test('pre-migration copy can be recovered after sale without another issuance', async () => {
  await contribute('dan','commit-c');
  const first=(await issue('dan','commit-c','token-c')).rows[0]!;
  await db.exec("UPDATE attribution_commits SET issued_pet_seed=NULL WHERE sha='commit-c'; UPDATE wild_seed_sources SET player_id='buyer' WHERE provenance_seed='commit-c';");
  const retry=(await issue('dan','commit-c','token-c')).rows[0]!;
  expect(retry).toMatchObject({out_pet_seed:first.out_pet_seed,out_created:false});
});

test('coauthors may trade copies from the same contribution', async () => {
  await contribute('earner-one','shared'); await contribute('earner-two','shared');
  const a=(await issue('earner-one','shared','token-one')).rows[0]!;
  const b=(await issue('earner-two','shared','token-two')).rows[0]!;
  expect(a.out_pet_seed).not.toBe(b.out_pet_seed);
  await db.query("UPDATE wild_seed_sources SET player_id='collector' WHERE provenance_seed='shared'");
  expect((await issue('earner-one','shared','token-one')).rows[0]!.out_created).toBe(false);
});

test('missing eligibility and sold-out editions do not create receipts', async () => {
  await expect(issue('unknown','missing','token-missing')).rejects.toThrow(/recorded contribution/);
  await contribute('rare-one','rare-a'); await contribute('rare-two','rare-b');
  await issue('rare-one','rare-a','token-rare-a','limited',1);
  expect((await issue('rare-two','rare-b','token-rare-b','limited',1)).rows).toHaveLength(0);
  expect((await db.query<{issued_pet_seed:string|null}>("SELECT issued_pet_seed FROM attribution_commits WHERE sha='rare-b'")).rows[0]!.issued_pet_seed).toBeNull();
});


test('new origin records reject edits and deletion', async () => {
  await contribute('protected','protected-sha');
  const copy=(await issue('protected','protected-sha','protected-token')).rows[0]!;
  await expect(db.query("UPDATE pet_ownership_events SET to_player_id='other' WHERE pet_seed=$1",[copy.out_pet_seed])).rejects.toThrow(/immutable/);
  await expect(db.query('DELETE FROM pet_ownership_events WHERE pet_seed=$1',[copy.out_pet_seed])).rejects.toThrow(/immutable/);
});

test('a receipt failure rolls back the copy, supply allocation and origin together', async () => {
  await contribute('atomic','atomic-sha');
  await db.exec(`CREATE FUNCTION fail_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.player_id='atomic' THEN RAISE EXCEPTION 'synthetic interruption'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_test_receipt BEFORE UPDATE ON attribution_commits FOR EACH ROW EXECUTE FUNCTION fail_test_receipt();`);
  await expect(issue('atomic','atomic-sha','atomic-token')).rejects.toThrow(/synthetic interruption/);
  expect((await db.query("SELECT * FROM wild_seed_sources WHERE provenance_seed='atomic-sha'")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM pet_printings WHERE id='atomic-sha'")).rows).toHaveLength(0);
  await db.exec('DROP TRIGGER fail_test_receipt ON attribution_commits');
  expect((await issue('atomic','atomic-sha','atomic-token')).rows[0]!.out_created).toBe(true);
});


test('quest issuance stays idempotent after transfer without a GitHub receipt', async () => {
  const statement = `SELECT * FROM issue_pet_copy('quest-earner','quest-earner','quest:week:one','subject','subject-seed','Test','set','rare','quest-printing',500,0,1,'Holo','genesis-v2','card:v2:set:subject:rare','quest-token')`;
  const first=(await db.query<{out_pet_seed:string;out_created:boolean}>(statement)).rows[0]!;
  await db.query("UPDATE wild_seed_sources SET player_id='quest-buyer' WHERE pet_seed=$1",[first.out_pet_seed]);
  const retry=(await db.query<{out_pet_seed:string;out_created:boolean}>(statement)).rows[0]!;
  expect(retry).toMatchObject({out_pet_seed:first.out_pet_seed,out_created:false});
  expect((await db.query("SELECT * FROM pet_ownership_events WHERE pet_seed=$1",[first.out_pet_seed])).rows).toHaveLength(1);
});
