INSERT INTO settings (key, value, description)
VALUES ('branding', '{"businessName":"Jai Shree Shyam Finance"}'::jsonb, 'Public business identity')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE branding_assets (
  kind text PRIMARY KEY CHECK (kind IN ('logo', 'favicon')),
  content_type text NOT NULL,
  bytes bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
