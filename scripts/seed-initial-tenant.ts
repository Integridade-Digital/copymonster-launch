#!/usr/bin/env ts-node
/**
 * Script de Seed Inicial - CopyMonster
 * 
 * Cria o tenant padrão "Integridade Digital" e atribui role 'owner'
 * ao primeiro usuário que se registrar.
 * 
 * Uso: pnpm exec ts-node scripts/seed-initial-tenant.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Carregar variáveis de ambiente
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Erro: Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas');
  console.error('Copie .env.example para .env.local e preencha com suas credenciais');
  process.exit(1);
}

// Criar cliente admin
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function seedInitialTenant() {
  console.log('🚀 Iniciando seed inicial do CopyMonster...\n');

  // 1. Verificar se tenant já existe
  console.log('📋 Verificando tenant "Integridade Digital"...');
  
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id, name, slug, status')
    .eq('slug', 'integridade-digital')
    .single();

  if (existingTenant) {
    console.log(`✅ Tenant já existe: ${existingTenant.name} (${existingTenant.slug})`);
  } else {
    // 2. Criar tenant padrão
    console.log('🏢 Criando tenant "Integridade Digital"...');
    
    const { data: newTenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: 'Integridade Digital',
        slug: 'integridade-digital',
        status: 'active',
        metadata: {
          is_default: true,
          created_by: 'system',
          description: 'Tenant padrão da Integridade Digital para operação do SaaS CopyMonster',
        },
      })
      .select()
      .single();

    if (tenantError) {
      console.error('❌ Erro ao criar tenant:', tenantError.message);
      process.exit(1);
    }

    console.log(`✅ Tenant criado: ${newTenant.name} (ID: ${newTenant.id})`);
  }

  const tenantId = existingTenant?.id || (await supabase.from('tenants').select('id').eq('slug', 'integridade-digital').single()).data?.id;

  // 3. Listar usuários existentes
  console.log('\n👥 Verificando usuários registrados...');
  
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, full_name');

  if (usersError) {
    console.error('⚠️ Aviso: Não foi possível listar usuários:', usersError.message);
  } else if (users && users.length > 0) {
    console.log(`📊 Encontrados ${users.length} usuário(s):`);
    users.forEach(u => console.log(`   - ${u.email}${u.full_name ? ` (${u.full_name})` : ''}`));
  } else {
    console.log('ℹ️  Nenhum usuário registrado ainda. O primeiro usuário a se registrar será automaticamente definido como owner.');
  }

  // 4. Instruções para o primeiro usuário
  console.log('\n📝 Próximos passos:');
  console.log('   1. Acesse a aplicação em http://localhost:3000');
  console.log('   2. Clique em "Criar conta"');
  console.log('   3. Preencha os dados do primeiro administrador');
  console.log('   4. Após o registro, execute este script novamente para atribuir role "owner"');
  
  // 5. Se houver usuários sem role, atribuir owner ao primeiro
  if (users && users.length > 0) {
    const firstUser = users[0];
    
    console.log(`\n🔐 Verificando role do usuário ${firstUser.email}...`);
    
    const { data: existingRole } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', firstUser.id)
      .eq('tenant_id', tenantId)
      .single();

    if (existingRole) {
      console.log(`✅ Usuário já possui role: ${existingRole.role}`);
    } else {
      console.log(`🎯 Atribuindo role "owner" para ${firstUser.email}...`);
      
      const { error: roleError } = await supabase
        .from('user_tenant_roles')
        .insert({
          user_id: firstUser.id,
          tenant_id: tenantId,
          role: 'owner',
        });

      if (roleError) {
        console.error('❌ Erro ao atribuir role:', roleError.message);
      } else {
        console.log(`✅ Role "owner" atribuída com sucesso!`);
        console.log(`\n🎉 Setup inicial concluído!`);
        console.log(`   ${firstUser.email} agora é OWNER do tenant Integridade Digital`);
      }
    }
  }

  console.log('\n✅ Seed inicial concluído com sucesso!\n');
}

// Executar seed
seedInitialTenant().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
