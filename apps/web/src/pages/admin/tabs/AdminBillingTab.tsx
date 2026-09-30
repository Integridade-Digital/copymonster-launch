import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminBillingTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Faturamento & Assinaturas</h3>
      <p className={css.placeholderSubtitle}>
        Visão agregada de faturamento, métricas Stripe e faturas da plataforma.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
