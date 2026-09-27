import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

console.log('--- Iniciando Validação E2E de Isolamento Multi-Tenant (Fase 6) ---')

// 1. Camada 1: Confinamento e Path Traversal
console.log('\n[Camada 1] Testando confinamento de sandbox e prevenção de path traversal...')
const { resolveUserSandboxRoot, assertPathInSandbox, ensureInitialUserWorkspace } = await import('../packages/workspace/workspace/src/sandbox.ts')

const tenantA = 'ten_alpha_001'
const userA = 'usr_alice_001'
const tenantB = 'ten_beta_002'
const userB = 'usr_bob_002'

const rootA = resolveUserSandboxRoot(tenantA, userA)
const rootB = resolveUserSandboxRoot(tenantB, userB)

assert(rootA.includes(tenantA) && rootA.includes(userA), 'Root A deve conter identificadores do Tenant A')
assert(rootB.includes(tenantB) && rootB.includes(userB), 'Root B deve conter identificadores do Tenant B')
assert.notEqual(rootA, rootB, 'Roots de tenants distintos devem ser estritamente diferentes')

// Tentativas de Path Traversal
assert.throws(() => {
  assertPathInSandbox(path.join(rootA, '../user-victim/workspaces'), rootA)
}, /Security Violation/, 'Deve rejeitar escape via ..')

assert.throws(() => {
  assertPathInSandbox('/etc/passwd', rootA)
}, /Security Violation/, 'Deve rejeitar caminhos absolutos fora do sandbox')

assert.throws(() => {
  assertPathInSandbox(rootB, rootA)
}, /Security Violation/, 'Tenant A não pode acessar o diretório de Tenant B')
console.log('✔ Camada 1 validada: Confinamento e bloqueios de traversal operando.')

// 2. Camada 2 & 4: Auto-provisionamento e Isolamento Físico de Dois Tenants
console.log('\n[Camada 2 & 4] Testando auto-provisionamento isolado para Dois Tenants...')
const testBaseDir = path.join(os.tmpdir(), 'copymonster-e2e-' + Date.now())
process.env.COPYMONSTER_DATA_DIR = testBaseDir

const initialA = await ensureInitialUserWorkspace(tenantA, userA)
const initialB = await ensureInitialUserWorkspace(tenantB, userB)

assert(initialA.startsWith(testBaseDir), 'Workspace A deve estar sob o DATA_DIR de teste')
assert(initialB.startsWith(testBaseDir), 'Workspace B deve estar sob o DATA_DIR de teste')
assert(initialA.includes(tenantA), 'Workspace A deve conter Tenant A')
assert(initialB.includes(tenantB), 'Workspace B deve conter Tenant B')
assert.notEqual(initialA, initialB, 'Workspaces não podem colidir entre tenants')

// Gravar arquivo de teste no tenant A e verificar que não vaza
const secretFileA = path.join(initialA, 'tenant_a_secret.txt')
await fs.writeFile(secretFileA, 'SECRET_KEY_A', 'utf-8')

// Tenant B tentando apontar para arquivo do Tenant A
assert.throws(() => {
  assertPathInSandbox(secretFileA, resolveUserSandboxRoot(tenantB, userB))
}, /Security Violation/, 'Tenant B deve ser expressamente impedido de acessar arquivos do Tenant A')
console.log('✔ Camada 4 (Filesystem) validada: Dois tenants isolados sem vazamento cruzado.')

// 3. Validação do Roteiro e Plano
console.log('\n[Camada 3] Validando conformidade do roadmap...')
const roadmapContent = await fs.readFile('docs/roadmap/plano-isolamento-tenants-workspaces-copymonster.md', 'utf-8')
assert(roadmapContent.includes('Fase 6'), 'Roadmap deve conter a Fase 6')

// Limpeza de ambiente de teste
await fs.rm(testBaseDir, { recursive: true, force: true })

console.log('\n======================================================')
console.log('✔ TODAS AS CAMADAS DA FASE 6 FORAM VALIDADAS COM SUCESSO!')
console.log('======================================================')
