#!/usr/bin/env node
/**
 * Data Cleanup Script for Supabase
 * Deletes all data except for 3 specified test accounts
 */

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

const headers = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
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

async function getUsersToPreserve() {
  console.log('\n=== Fetching users to preserve ===');
  const emails = PRESERVE_EMAILS.map(e => `"${e}"`).join(',');
  const users = await fetchWithAuth(`users?email=in.(${emails})&select=id,email`);
  console.log('Users to preserve:', users);
  return users;
}

async function getTenantsForUsers(userIds) {
  console.log('\n=== Fetching tenants for preserved users ===');
  // tenants have metadata->>'owner_user_id'
  const allTenants = await fetchWithAuth('tenants?select=id,name,slug,metadata');
  const userTenants = allTenants.filter(t =>
    t.metadata && t.metadata.owner_user_id && userIds.includes(t.metadata.owner_user_id)
  );
  console.log('Tenants to preserve:', userTenants);
  return userTenants;
}

async function getAllTenants() {
  console.log('\n=== Fetching all tenants ===');
  const tenants = await fetchWithAuth('tenants?select=id,name,slug,metadata');
  console.log(`Total tenants: ${tenants.length}`);
  return tenants;
}

async function getAllUsers() {
  console.log('\n=== Fetching all users ===');
  const users = await fetchWithAuth('users?select=id,email');
  console.log(`Total users: ${users.length}`);
  return users;
}

async function deleteSessionsForTenants(tenantIds) {
  if (tenantIds.length === 0) return;
  console.log('\n=== Deleting sessions for tenant IDs:', tenantIds);
  const ids = tenantIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`sessions?tenant_id=in.(${ids})`, { method: 'DELETE' });
  await fetchWithAuth(`sessions_index?tenant_id=in.(${ids})`, { method: 'DELETE' });
  console.log('Sessions deleted');
}

async function deleteWorkspacesForTenants(tenantIds) {
  if (tenantIds.length === 0) return;
  console.log('\n=== Deleting workspaces for tenant IDs:', tenantIds);
  const ids = tenantIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`workspaces_meta?tenant_id=in.(${ids})`, { method: 'DELETE' });
  console.log('Workspaces deleted');
}

async function deleteTenantLlmProvidersForTenants(tenantIds) {
  if (tenantIds.length === 0) return;
  console.log('\n=== Deleting tenant_llm_providers for tenant IDs:', tenantIds);
  const ids = tenantIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`tenant_llm_providers?tenant_id=in.(${ids})`, { method: 'DELETE' });
  console.log('Tenant LLM providers deleted');
}

async function deleteAuditLogsForTenants(tenantIds) {
  if (tenantIds.length === 0) return;
  console.log('\n=== Deleting audit_logs for tenant IDs:', tenantIds);
  const ids = tenantIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`audit_logs?tenant_id=in.(${ids})`, { method: 'DELETE' });
  console.log('Audit logs deleted');
}

async function deleteTenants(tenantIds) {
  if (tenantIds.length === 0) return;
  console.log('\n=== Deleting tenants:', tenantIds);
  const ids = tenantIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`tenants?id=in.(${ids})`, { method: 'DELETE' });
  console.log('Tenants deleted');
}

async function deleteOrphanUsers(preserveUserIds) {
  console.log('\n=== Finding and deleting orphan users ===');
  const allUsers = await getAllUsers();
  const preserveIds = new Set(preserveUserIds);

  // Also get tenant owner IDs to not delete them
  const allTenants = await fetchWithAuth('tenants?select=metadata');
  const tenantOwnerIds = new Set();
  for (const t of allTenants) {
    if (t.metadata && t.metadata.owner_user_id) {
      tenantOwnerIds.add(t.metadata.owner_user_id);
    }
  }

  for (const user of allUsers) {
    if (!preserveIds.has(user.id) && !tenantOwnerIds.has(user.id)) {
      console.log(`Deleting user: ${user.email} (${user.id})`);
      try {
        await fetchWithAuth(`users?id=eq.${user.id}`, { method: 'DELETE' });
      } catch (e) {
        console.log(`Failed to delete user ${user.email}:`, e.message);
      }
    }
  }
  console.log('Orphan users deleted');
}

async function deleteSessionsForUsers(userIds) {
  if (userIds.length === 0) return;
  console.log('\n=== Deleting sessions for preserved users ===');
  const ids = userIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`sessions?user_id=in.(${ids})`, { method: 'DELETE' });
  await fetchWithAuth(`sessions_index?user_id=in.(${ids})`, { method: 'DELETE' });
  console.log('Sessions for preserved users deleted');
}

async function deleteWorkspacesForUsers(userIds) {
  if (userIds.length === 0) return;
  console.log('\n=== Deleting workspaces_meta for preserved users ===');
  const ids = userIds.map(id => `"${id}"`).join(',');
  await fetchWithAuth(`workspaces_meta?user_id=in.(${ids})`, { method: 'DELETE' });
  console.log('Workspaces for preserved users deleted');
}

async function deleteTenantLlmProvidersForUsers(userIds) {
  if (userIds.length === 0) return;
  console.log('\n=== Deleting tenant_llm_providers for preserved users\' tenants ===');
  // First get tenant IDs for these users
  const userTenants = await getTenantsForUsers(userIds);
  const tenantIds = userTenants.map(t => t.id);
  if (tenantIds.length > 0) {
    const tids = tenantIds.map(id => `"${id}"`).join(',');
    await fetchWithAuth(`tenant_llm_providers?tenant_id=in.(${tids})`, { method: 'DELETE' });
  }
  console.log('Tenant LLM providers for preserved users deleted');
}

async function main() {
  console.log('=== Starting Data Cleanup ===');
  console.log('Preserving emails:', PRESERVE_EMAILS);

  try {
    // Step 1: Get users to preserve
    const preserveUsers = await getUsersToPreserve();
    const preserveUserIds = preserveUsers.map(u => u.id);

    if (preserveUserIds.length !== 3) {
      console.warn(`WARNING: Expected 3 users, found ${preserveUserIds.length}`);
    }

    // Step 2: Get tenants for preserved users
    const preserveTenants = await getTenantsForUsers(preserveUserIds);
    const preserveTenantIds = preserveTenants.map(t => t.id);

    // Step 3: Get all tenants
    const allTenants = await getAllTenants();
    const allTenantIds = allTenants.map(t => t.id);

    // Step 4: Identify tenants to delete (not owned by preserved users)
    const tenantsToDelete = allTenants.filter(t => !preserveTenantIds.includes(t.id));
    const tenantIdsToDelete = tenantsToDelete.map(t => t.id);

    console.log('\n=== Summary ===');
    console.log(`Preserved users: ${preserveUserIds.length}`);
    console.log(`Preserved tenants: ${preserveTenantIds.length}`);
    console.log(`Tenants to delete: ${tenantIdsToDelete.length}`);
    console.log('Tenants to delete:', tenantsToDelete.map(t => `${t.name} (${t.id})`));

    // Step 5: Clean up preserved users' chat history
    await deleteSessionsForUsers(preserveUserIds);
    await deleteWorkspacesForUsers(preserveUserIds);
    await deleteTenantLlmProvidersForUsers(preserveUserIds);

    // Step 6: Delete other tenants' data
    if (tenantIdsToDelete.length > 0) {
      await deleteSessionsForTenants(tenantIdsToDelete);
      await deleteWorkspacesForTenants(tenantIdsToDelete);
      await deleteTenantLlmProvidersForTenants(tenantIdsToDelete);
      await deleteAuditLogsForTenants(tenantIdsToDelete);
      await deleteTenants(tenantIdsToDelete);
    }

    // Step 7: Delete orphan users (users not in preserved list and not owning tenants)
    await deleteOrphanUsers(preserveUserIds);

    // Final verification
    console.log('\n=== Final Verification ===');
    const finalUsers = await getAllUsers();
    const finalTenants = await getAllTenants();
    console.log(`Remaining users: ${finalUsers.length}`);
    console.log(`Remaining tenants: ${finalTenants.length}`);
    console.log('Remaining users:', finalUsers.map(u => u.email));
    console.log('Remaining tenants:', finalTenants.map(t => `${t.name} (${t.slug})`));

    console.log('\n=== Cleanup Complete ===');

  } catch (error) {
    console.error('\n=== Cleanup Failed ===');
    console.error(error);
    process.exit(1);
  }
}

main();