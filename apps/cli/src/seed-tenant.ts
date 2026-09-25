/**
 * `dsh seed-tenant`: create the default Integridade Digital tenant and give the
 * first registered profile the `owner` role.
 *
 * The Supabase clients are imported lazily, after `loadLayeredEnv` materializes
 * the environment the client module validates at load.
 * @module @deepseek-ai/dsh/seed-tenant
 */

import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from '@deepseek-ai/dsh-constants'

/**
 * Run the initial CopyMonster seed.
 * @returns process exit code: 0 on success, 1 on a fatal failure.
 */
export async function runSeedTenant(): Promise<number> {
  loadLayeredEnv('dsh', resolveDshHome())

  if ((process.env.SUPABASE_URL ?? '') === '' || (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '') === '') {
    console.error('seed-tenant: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
    return 1
  }

  const { supabaseAdminClient } = await import('@deepseek-ai/dsh-supabase-client')

  console.log('seed-tenant: starting CopyMonster seed\n')

  const { data: existing, error: existingError } = await supabaseAdminClient
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', DEFAULT_TENANT_SLUG)
    .maybeSingle()

  if (existingError !== null) {
    console.error('seed-tenant: failed to read tenants:', existingError.message)
    return 1
  }

  let tenantId: string
  if (existing !== null) {
    console.log(`tenant already exists: ${existing.name} (${existing.slug})`)
    tenantId = existing.id
  } else {
    const { data: created, error: createError } = await supabaseAdminClient
      .from('tenants')
      .insert({
        id: DEFAULT_TENANT_ID,
        name: 'Integridade Digital',
        slug: DEFAULT_TENANT_SLUG,
        status: 'active',
        metadata: { is_default: true, created_by: 'system' },
      })
      .select()
      .single()

    if (createError !== null || created === null) {
      console.error('seed-tenant: failed to create tenant:', createError?.message ?? 'no row returned')
      return 1
    }
    console.log(`tenant created: ${created.name} (${created.id})`)
    tenantId = created.id
  }

  const { data: users, error: usersError } = await supabaseAdminClient
    .from('users')
    .select('id, email, full_name')
    .order('created_at', { ascending: true })

  if (usersError !== null) {
    console.error('seed-tenant: failed to list users:', usersError.message)
    return 1
  }

  if (users === null || users.length === 0) {
    console.log('no profiles registered yet; the first signup runs this command again to receive `owner`.')
    return 0
  }

  const first = users[0]
  if (first === undefined) {
    console.log('no profiles registered yet.')
    return 0
  }

  const { data: roleRow, error: roleReadError } = await supabaseAdminClient
    .from('user_tenant_roles')
    .select('role')
    .eq('user_id', first.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (roleReadError !== null) {
    console.error('seed-tenant: failed to read roles:', roleReadError.message)
    return 1
  }

  if (roleRow !== null) {
    console.log(`${first.email} already has role "${roleRow.role}"`)
    return 0
  }

  const { error: roleInsertError } = await supabaseAdminClient
    .from('user_tenant_roles')
    .insert({ user_id: first.id, tenant_id: tenantId, role: 'owner' })

  if (roleInsertError !== null) {
    console.error('seed-tenant: failed to assign owner:', roleInsertError.message)
    return 1
  }

  console.log(`${first.email} is now OWNER of ${DEFAULT_TENANT_SLUG}`)
  return 0
}
