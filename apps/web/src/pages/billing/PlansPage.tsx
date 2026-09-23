import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase/client'

interface Plan {
  id: string
  name: string
  slug: string
  price_cents: number
  currency: string
  features: string[]
  limits: Record<string, number>
  stripe_price_id?: string
}

interface TenantSubscription {
  subscription_status: string
  current_period_end: string | null
  plan_id: string | null
}

export function PlansPage() {
  const { user } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      // Carregar planos disponíveis
      const { data: plansData } = await supabase
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('price_cents')

      setPlans(plansData || [])

      // Carregar assinatura atual do tenant
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('subscription_status, current_period_end, plan_id')
        .eq('id', user?.tenantId ?? '')
        .single()

      setSubscription(tenantData || null)
    } catch (error: unknown) {
      console.error('Error loading plans:', error)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSubscribe(planSlug: string) {
    const plan = plans.find(p => p.slug === planSlug)
    if (!plan || !plan.stripe_price_id) {
      alert('Plano não disponível para assinatura online')
      return
    }

    setIsProcessing(planSlug)

    try {
      const response = await fetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession())?.data?.session?.access_token}`,
        },
        body: JSON.stringify({
          priceId: plan.stripe_price_id,
          tenantId: user?.tenantId ?? '',
        }),
      })

      if (!response.ok) {
        const error = await response.json() as { message?: string }
        throw new Error(error.message || 'Erro ao criar checkout')
      }

      const { url } = await response.json()

      // Redirecionar para checkout do Stripe
      window.location.href = url
    } catch (error: unknown) {
      alert('Erro: ' + (error instanceof Error ? error.message : String(error)))
      setIsProcessing(null)
    }
  }

  async function handleManageSubscription() {
    try {
      const response = await fetch('/api/billing/create-portal-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession())?.data?.session?.access_token}`,
        },
        body: JSON.stringify({ tenantId: user?.tenantId ?? '' }),
      })

      if (!response.ok) throw new Error('Erro ao criar portal')

      const { url } = await response.json()
      window.location.href = url
    } catch (error: unknown) {
      alert('Erro: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="py-12 px-4 max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Escolha seu Plano</h1>
        <p className="text-xl text-gray-600">
          Planos flexíveis para escalar seu copywriting e funis de lançamento
        </p>
      </div>

      {subscription && subscription.subscription_status === 'active' && (
        <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-lg text-center">
          <p className="text-green-800">
            ✅ Você está assinando o plano <strong>{plans.find(p => p.id === subscription.plan_id)?.name}</strong>
          </p>
          {subscription.current_period_end && (
            <p className="text-sm text-green-600 mt-1">
              Renovação em: {new Date(subscription.current_period_end).toLocaleDateString('pt-BR')}
            </p>
          )}
          <button
            onClick={handleManageSubscription}
            className="mt-3 text-sm text-green-700 underline hover:text-green-900"
          >
            Gerenciar assinatura
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        {plans.map((plan) => {
          const isCurrentPlan = subscription?.plan_id === plan.id
          const isFree = plan.slug === 'free'

          return (
            <div
              key={plan.id}
              className={`border rounded-2xl p-8 transition-all ${
                isCurrentPlan
                  ? 'border-green-500 bg-green-50 shadow-lg'
                  : 'border-gray-200 hover:shadow-xl'
              }`}
            >
              <h3 className="text-2xl font-bold text-gray-900">{plan.name}</h3>

              <div className="mt-4 mb-6">
                <span className="text-4xl font-bold text-gray-900">
                  R$ {(plan.price_cents / 100).toFixed(0)}
                </span>
                <span className="text-gray-600">/mês</span>
              </div>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start">
                    <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>

              {plan.limits && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-semibold text-gray-900 mb-2">Limites:</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {Object.entries(plan.limits).map(([key, value]) => (
                      <li key={key}>
                        • {key.replace('_', ' ')}: {value === -1 ? 'Ilimitado' : String(value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={() => handleSubscribe(plan.slug)}
                disabled={isCurrentPlan || isProcessing === plan.slug}
                className={`w-full py-3 rounded-lg font-semibold transition ${
                  isCurrentPlan
                    ? 'bg-green-600 text-white cursor-default'
                    : isFree
                      ? 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                } disabled:opacity-50`}
              >
                {isCurrentPlan ? 'Plano Atual' : isFree ? 'Plano Gratuito' : 'Assinar Agora'}
              </button>
            </div>
          )
        })}
      </div>

      {/* FAQ Section */}
      <div className="mt-16 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-8">Perguntas Frequentes</h2>

        <div className="space-y-4">
          <details className="group bg-white border border-gray-200 rounded-lg">
            <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
              <span>Posso cancelar a qualquer momento?</span>
              <span className="transform group-open:rotate-180 transition">▼</span>
            </summary>
            <div className="px-4 pb-4 text-gray-600">
              Sim! Você pode cancelar sua assinatura quando quiser através do portal do cliente.
              Seu acesso permanece ativo até o final do período pago.
            </div>
          </details>

          <details className="group bg-white border border-gray-200 rounded-lg">
            <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
              <span>Como funciona o período de trial?</span>
              <span className="transform group-open:rotate-180 transition">▼</span>
            </summary>
            <div className="px-4 pb-4 text-gray-600">
              Novos tenants recebem 14 dias de trial gratuito com acesso completo ao plano Profissional.
              Não é necessário cartão de crédito para começar.
            </div>
          </details>

          <details className="group bg-white border border-gray-200 rounded-lg">
            <summary className="flex justify-between items-center cursor-pointer p-4 font-medium">
              <span>O que acontece se eu exceder os limites?</span>
              <span className="transform group-open:rotate-180 transition">▼</span>
            </summary>
            <div className="px-4 pb-4 text-gray-600">
              Ao atingir o limite de sessões ou tokens, você será notificado e poderá fazer upgrade
              para um plano superior. Sessões existentes não são afetadas.
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
