CREATE TABLE solo_stats (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played integer NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  kills bigint NOT NULL DEFAULT 0 CHECK (kills >= 0),
  deaths bigint NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  headshots bigint NOT NULL DEFAULT 0 CHECK (headshots >= 0),
  best_score bigint NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  best_wave integer NOT NULL DEFAULT 0 CHECK (best_wave >= 0),
  play_seconds bigint NOT NULL DEFAULT 0 CHECK (play_seconds >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO solo_stats(user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE solo_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_key varchar(32) NOT NULL,
  score bigint NOT NULL CHECK (score BETWEEN 0 AND 1000000000),
  wave integer NOT NULL CHECK (wave BETWEEN 0 AND 10000),
  kills integer NOT NULL CHECK (kills BETWEEN 0 AND 100000),
  deaths integer NOT NULL CHECK (deaths BETWEEN 0 AND 1),
  headshots integer NOT NULL CHECK (headshots BETWEEN 0 AND kills),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 0 AND 86400),
  ended_reason varchar(12) NOT NULL CHECK (ended_reason IN ('death', 'left')),
  ended_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solo_runs_user_ended_idx ON solo_runs(user_id, ended_at DESC);

CREATE TABLE duel_requests (
  id uuid PRIMARY KEY,
  challenger_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenged_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code char(5) NOT NULL UNIQUE,
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  CHECK (challenger_id <> challenged_id)
);
CREATE INDEX duel_requests_challenged_idx ON duel_requests(challenged_id, status, created_at DESC);
CREATE INDEX duel_requests_challenger_idx ON duel_requests(challenger_id, status, created_at DESC);
