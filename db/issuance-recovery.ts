// Run after serialized-pet and marketplace migrations. No network or DB side effects
// here: the same SQL is exercised against an isolated PostgreSQL engine in tests.
export const issuanceRecoveryStatements = [
`ALTER TABLE attribution_commits ADD COLUMN IF NOT EXISTS issued_pet_seed text;`,
`CREATE INDEX IF NOT EXISTS attribution_commits_pending_issue_idx
  ON attribution_commits(player_id, github_login, discovered_at, sha)
  WHERE issued_pet_seed IS NULL;

-- Current owner is mutable. Copy identity and the original earning event are not.
-- Different earners of the same coauthored commit may legitimately trade copies.`,
`DROP INDEX IF EXISTS wild_seed_sources_player_provenance_uniq;`,
`CREATE UNIQUE INDEX IF NOT EXISTS wild_seed_sources_copy_provenance_uniq
  ON wild_seed_sources(provenance_seed, (split_part(pet_seed, ':', 8)))
  WHERE provenance_seed IS NOT NULL AND pet_seed LIKE 'card:v%';`,
`CREATE OR REPLACE FUNCTION record_pet_mint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pet_ownership_events(id,pet_seed,sequence,kind,to_player_id,reason,occurred_at)
  VALUES ('own:mint:' || md5(NEW.pet_seed),NEW.pet_seed,1,'mint',NEW.player_id,'earned',NEW.earned_at);
  RETURN NEW;
END $$;`,
`DROP TRIGGER IF EXISTS wild_seed_sources_record_mint ON wild_seed_sources;`,
`CREATE TRIGGER wild_seed_sources_record_mint AFTER INSERT ON wild_seed_sources
  FOR EACH ROW EXECUTE FUNCTION record_pet_mint();

-- Bind the receipt in the same transaction as issuance. A failed refresh can
-- resume the queue without depending on which SHAs GitHub returns next time.`,
`CREATE OR REPLACE FUNCTION issue_pending_pet_copy(
  p_player text,p_login text,p_provenance text,p_subject text,p_subject_seed text,p_name text,
  p_set text,p_variant text,p_printing text,p_run integer,p_offset integer,p_step integer,
  p_finish text,p_recipe text,p_prefix text,p_token text
) RETURNS TABLE(out_pet_seed text,out_serial_number integer,out_print_run integer,out_printing_id text,out_created boolean)
LANGUAGE plpgsql AS $$
DECLARE receipt record; copy record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_player || ':' || p_provenance,0));
  SELECT * INTO receipt FROM attribution_commits
    WHERE player_id=p_player AND github_login=p_login AND sha=p_provenance FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'issuance requires a recorded contribution'; END IF;
  IF receipt.issued_pet_seed IS NOT NULL THEN
    RETURN QUERY SELECT w.pet_seed,w.serial_number,w.print_run,w.printing_id,false
      FROM wild_seed_sources w WHERE w.pet_seed=receipt.issued_pet_seed;
    IF NOT FOUND THEN RAISE EXCEPTION 'issuance receipt has no collectible'; END IF;
    RETURN;
  END IF;
  -- Recover old copies even if they were sold before this migration.
  SELECT w.pet_seed,w.serial_number,w.print_run,w.printing_id INTO copy
    FROM wild_seed_sources w WHERE w.provenance_seed=p_provenance
      AND split_part(w.pet_seed,':',8)=p_token AND w.pet_seed LIKE 'card:v%' LIMIT 1;
  IF FOUND THEN
    UPDATE attribution_commits SET issued_pet_seed=copy.pet_seed
      WHERE player_id=p_player AND github_login=p_login AND sha=p_provenance;
    RETURN QUERY SELECT copy.pet_seed::text,copy.serial_number::integer,copy.print_run::integer,copy.printing_id::text,false;
    RETURN;
  END IF;
  SELECT * INTO copy FROM issue_pet_copy(p_player,p_login,p_provenance,p_subject,p_subject_seed,p_name,
    p_set,p_variant,p_printing,p_run,p_offset,p_step,p_finish,p_recipe,p_prefix,p_token);
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE attribution_commits SET issued_pet_seed=copy.out_pet_seed
    WHERE player_id=p_player AND github_login=p_login AND sha=p_provenance;
  RETURN QUERY SELECT copy.out_pet_seed::text,copy.out_serial_number::integer,copy.out_print_run::integer,copy.out_printing_id::text,copy.out_created::boolean;
END $$;`
];
export const issuanceRecoverySql = issuanceRecoveryStatements.join("\n");
