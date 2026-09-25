import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-auth-context',
  ['lib/types/index.js'],
  { hostPhase: true },
)
