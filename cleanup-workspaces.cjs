#!/usr/bin/env node
/**
 * Workspace Domain Cleanup Script
 * Clears workspace domain JSON storage for deleted accounts
 * Keeps only workspaces for the 3 preserved test accounts
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://eyzurphuebvijvynatut.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required. Provide it in the environment (for example: set -a; . ./.env; set +a).');
  process.exit(1);
}

const PRESERVE_EMAILS = [
  'integridade.digital@gmail.com',
  'eusouadrianovieira@gmail.com',
  'adrianomultiplicadordetalentos@gmail.com'
];

const USERS_DIR = '/var/lib/dsh-server-login/users';

const headers = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchWithAuth(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getPreservedUserIds() {
  console.log('=== Fetching preserved user IDs from Supabase ===');
  const emails = PRESERVE_EMAILS.map(e => `"${e}"`).join(',');
  const users = await fetchWithAuth(`users?email=in.(${emails})&select=id,email`);
  console.log('Preserved users:', users.map(u => `${u.email} (${u.id})`));
  return new Set(users.map(u => u.id));
}

async function getAllUserDirs() {
  console.log('\n=== Scanning user directories ===');
  const entries = fs.readdirSync(USERS_DIR, { withFileTypes: true });
  const userDirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  console.log(`Found ${userDirs.length} user directories`);
  return userDirs;
}

function clearWorkspaceJson(userDir) {
  const workspaceJsonPath = path.join(USERS_DIR, userDir, 'home', 'storages', 'workspace.json');

  if (!fs.existsSync(workspaceJsonPath)) {
    console.log(`  No workspace.json found for ${userDir}`);
    return false;
  }

  try {
    const content = fs.readFileSync(workspaceJsonPath, 'utf8');
    const data = JSON.parse(content);

    // Check if there are any workspaces to clear
    const workspaceCount = Object.keys(data.tables?.workspaces || {}).length;

    if (workspaceCount === 0) {
      console.log(`  No workspaces to clear for ${userDir}`);
      return false;
    }

    // Clear the workspaces table
    data.tables.workspaces = {};

    // Also clear the global workspaceIds array
    if (data.global) {
      data.global.workspaceIds = [];
    }

    fs.writeFileSync(workspaceJsonPath, JSON.stringify(data, null, 2));
    console.log(`  Cleared ${workspaceCount} workspaces for ${userDir}`);
    return true;
  } catch (error) {
    console.error(`  Error processing ${userDir}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('=== Starting Workspace Domain Cleanup ===');
  console.log('Preserving emails:', PRESERVE_EMAILS);

  try {
    // Step 1: Get preserved user IDs
    const preserveUserIds = await getPreservedUserIds();

    if (preserveUserIds.size !== 3) {
      console.warn(`WARNING: Expected 3 users, found ${preserveUserIds.size}`);
    }

    // Step 2: Get all user directories
    const userDirs = await getAllUserDirs();

    // Step 3: Clear workspaces for non-preserved users
    let clearedCount = 0;
    let skippedCount = 0;

    for (const userDir of userDirs) {
      // The user directory name is the user ID
      if (preserveUserIds.has(userDir)) {
        console.log(`\nPreserving workspaces for user: ${userDir}`);
        skippedCount++;
        continue;
      }

      console.log(`\nCleaning workspaces for deleted user: ${userDir}`);
      const cleared = clearWorkspaceJson(userDir);
      if (cleared) clearedCount++;
    }

    console.log('\n=== Cleanup Complete ===');
    console.log(`Users preserved: ${skippedCount}`);
    console.log(`Users cleaned: ${clearedCount}`);
    console.log(`Total users processed: ${userDirs.length}`);

  } catch (error) {
    console.error('\n=== Cleanup Failed ===');
    console.error(error);
    process.exit(1);
  }
}

main();