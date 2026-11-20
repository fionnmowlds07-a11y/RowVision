-- One row per click on a download button. No IP address and nothing else that could pick out a person.
CREATE TABLE IF NOT EXISTS downloads (
  at TEXT NOT NULL,      -- UTC time, e.g. 2026-11-20T14:03:11Z
  file TEXT NOT NULL,    -- deb or appimage
  country TEXT           -- two-letter code from Cloudflare, or null
);
CREATE INDEX IF NOT EXISTS downloads_at ON downloads (at);
