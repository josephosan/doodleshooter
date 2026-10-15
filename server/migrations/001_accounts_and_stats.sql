CREATE TABLE users (
  id uuid PRIMARY KEY,
  username varchar(14) NOT NULL,
  username_key varchar(14) GENERATED ALWAYS AS (lower(username)) STORED,
  password_hash char(128) NOT NULL,
  password_salt char(32) NOT NULL,
  color varchar(12) NOT NULL DEFAULT 'blue' CHECK (color IN ('blue', 'red', 'orange', 'green', 'pink', 'black')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_unique UNIQUE (username_key)
);

CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE games (
  id uuid PRIMARY KEY,
  mode varchar(8) NOT NULL CHECK (mode IN ('ffa', 'teams')),
  map_key varchar(32) NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 0 AND 7200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX games_ended_at_idx ON games(ended_at DESC);

CREATE TABLE game_players (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username_snapshot varchar(14) NOT NULL,
  team varchar(8) CHECK (team IS NULL OR team IN ('red', 'black')),
  color varchar(12) NOT NULL CHECK (color IN ('blue', 'red', 'orange', 'green', 'pink', 'black')),
  kills integer NOT NULL CHECK (kills BETWEEN 0 AND 1000),
  deaths integer NOT NULL CHECK (deaths BETWEEN 0 AND 1000),
  headshots integer NOT NULL CHECK (headshots BETWEEN 0 AND kills),
  result varchar(8) NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX game_players_user_id_idx ON game_players(user_id);
CREATE INDEX game_players_ranking_idx ON game_players(kills DESC, headshots DESC, deaths ASC);

CREATE TABLE user_stats (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played integer NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  kills bigint NOT NULL DEFAULT 0 CHECK (kills >= 0),
  deaths bigint NOT NULL DEFAULT 0 CHECK (deaths >= 0),
  headshots bigint NOT NULL DEFAULT 0 CHECK (headshots >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_stats_leaderboard_idx ON user_stats(kills DESC, headshots DESC, deaths ASC);
