const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://eyzurphuebvijvynatut.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required. Provide it in the environment (for example: set -a; . ./.env; set +a).');
  process.exit(1);
}

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

async function main() {
  // Get preserved user IDs
  const emails = ['integridade.digital@gmail.com', 'eusouadrianovieira@gmail.com', 'adrianomultiplicadordetalentos@gmail.com'].map(e => `"${e}"`).join(',');
  const users = await fetchWithAuth(`users?email=in.(${emails})&select=id,email`);
  const preserveUserIds = new Set(users.map(u => u.id));

  // Get all tenants
  const tenants = await fetchWithAuth('tenants?select=id,name,slug,metadata');
  const preserveTenantIds = new Set();
  for (const t of tenants) {
    if (t.metadata && t.metadata.owner_user_id && preserveUserIds.has(t.metadata.owner_user_id)) {
      preserveTenantIds.add(t.id);
    }
  }

  console.log('Preserved tenant IDs:', preserveTenantIds);

  // Get workspaces_meta
  const workspaces = await fetchWithAuth('workspaces_meta?select=id,workspace_id,title,tenant_id,relative_path,deleted_at');
  console.log('\nAll workspaces_meta:');
  for (const ws of workspaces) {
    const preserved = preserveTenantIds.has(ws.tenant_id) ? ' (PRESERVED)' : ' (TO DELETE)';
    console.log(`  ${ws.title} (${ws.workspace_id}) - tenant: ${ws.tenant_id}${preserved} - deleted_at: ${ws.deleted_at}`);
  }

  // Delete workspaces for non-preserved tenants
  const toDelete = workspaces.filter(ws => !preserveTenantIds.has(ws.tenant_id));
  console.log(`\nWorkspaces to delete: ${toDelete.length}`);

  for (const ws of toDelete) {
    console.log(`Deleting: ${ws.title} (${ws.workspace_id})`);
    await fetchWithAuth(`workspaces_meta?id=eq.${ws.id}`, { method: 'DELETE' });
  }

  console.log('Done!');
}

main().catch(console.error);
