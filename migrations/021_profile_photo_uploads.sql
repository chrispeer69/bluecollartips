CREATE TABLE IF NOT EXISTS profile_photos (
  driver_id uuid PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  image_data bytea NOT NULL,
  content_type text NOT NULL DEFAULT 'image/jpeg' CHECK (content_type = 'image/jpeg'),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  width integer NOT NULL CHECK (width = 512),
  height integer NOT NULL CHECK (height = 512),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_photo_upload_rate_limits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, window_start)
);

CREATE INDEX IF NOT EXISTS profile_photo_upload_rate_window_idx
  ON profile_photo_upload_rate_limits(window_start);
