#!/usr/bin/env bun
/**
 * Update hub database with current working credentials from ~/.claude/.credentials.json
 */

import Database from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';

const CREDENTIALS_FILE = join(homedir(), '.claude', '.credentials.json');
const DB_FILE = 'agentdeck.db';

async function main() {
  // Read current credentials
  const file = Bun.file(CREDENTIALS_FILE);
  if (!(await file.exists())) {
    console.error('No credentials file found at', CREDENTIALS_FILE);
    process.exit(1);
  }

  const credentials = await file.json();
  const oauth = credentials.claudeAiOauth;

  if (!oauth) {
    console.error('No OAuth credentials found in file');
    process.exit(1);
  }

  console.log('Found credentials:');
  console.log('  Access token:', oauth.accessToken.slice(0, 20) + '...');
  console.log('  Refresh token:', oauth.refreshToken.slice(0, 20) + '...');
  console.log('  Expires at:', new Date(oauth.expiresAt));
  console.log('  Scopes:', oauth.scopes);
  console.log('  Subscription:', oauth.subscriptionType);

  // Open database
  const db = new Database(DB_FILE);

  // Update credentials table
  const result = db.query(`
    UPDATE credentials
    SET
      access_token = ?,
      refresh_token = ?,
      expires_at = ?,
      updated_at = ?
    WHERE is_default = 1
  `).run(
    oauth.accessToken,
    oauth.refreshToken,
    oauth.expiresAt, // Store as number (Unix timestamp in ms)
    Date.now()
  );

  console.log('\n✅ Updated', result.changes, 'credential record(s) in database');

  // Verify update
  const verify = db.query(`
    SELECT
      type,
      substr(access_token, 1, 20) as token_preview,
      expires_at,
      is_default
    FROM credentials
    WHERE is_default = 1
  `).get();

  console.log('\nVerified in DB:');
  console.log(verify);

  db.close();
}

main().catch(console.error);
