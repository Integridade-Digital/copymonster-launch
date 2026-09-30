import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminOverviewTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Visão Geral do Sistema</h3>
      <p className={css.placeholderSubtitle}>
        Métricas consolidadas de uso, status dos serviços e atividades recentes da plataforma.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
