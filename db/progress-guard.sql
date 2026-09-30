-- Cumulative self-reported progress must survive sparse/old clients and concurrent writes.
-- Verified scores and mutable preferences remain owned by their existing code paths.
CREATE TABLE IF NOT EXISTS player_progress_history (
  player_id text NOT NULL,
  snapshot_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  PRIMARY KEY (player_id, snapshot_day)
);

-- next
CREATE OR REPLACE FUNCTION renown_skill_level(xp numeric) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  points numeric := 0;
  lvl integer;
BEGIN
  FOR lvl IN 1..98 LOOP
    points := points + floor(lvl + 300 * power(2::numeric, lvl::numeric / 7));
    IF xp < floor(points / 4) THEN RETURN lvl; END IF;
  END LOOP;
  RETURN 99;
END;
$$;

-- next
CREATE OR REPLACE FUNCTION renown_preserve_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO player_progress_history (player_id, snapshot)
    VALUES (OLD.id, to_jsonb(OLD)) ON CONFLICT DO NOTHING;
  SELECT coalesce(jsonb_object_agg(key, xp), '{}'::jsonb) INTO NEW.skill_xp
  FROM (
    SELECT key, max(value::numeric) AS xp FROM (
      SELECT key, value FROM jsonb_each(coalesce(OLD.skill_xp, '{}'::jsonb))
      UNION ALL
      SELECT key, value FROM jsonb_each(coalesce(NEW.skill_xp, '{}'::jsonb))
    ) entries WHERE jsonb_typeof(value) = 'number' GROUP BY key
  ) merged;
  NEW.xp := greatest(OLD.xp, NEW.xp);
  NEW.level := greatest(OLD.level, NEW.level);
  NEW.total_level := greatest(OLD.total_level, NEW.total_level,
    (SELECT sum(renown_skill_level(coalesce((NEW.skill_xp->>key)::numeric, 0)))
     FROM jsonb_array_elements_text('__SKILL_IDS__'::jsonb) AS skills(key)));
  NEW.active_sec := greatest(OLD.active_sec, NEW.active_sec);
  NEW.achievements := greatest(OLD.achievements, NEW.achievements);
  NEW.oss_commits := greatest(OLD.oss_commits, NEW.oss_commits);
  NEW.streak := greatest(OLD.streak, NEW.streak);
  IF NEW.handle IN ('player', 'anon', '') AND OLD.handle NOT IN ('player', 'anon', '') THEN
    NEW.handle := OLD.handle;
  END IF;
  RETURN NEW;
END;
$$;

-- next
DROP TRIGGER IF EXISTS renown_preserve_progress ON players;
-- next
CREATE TRIGGER renown_preserve_progress BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION renown_preserve_progress();
