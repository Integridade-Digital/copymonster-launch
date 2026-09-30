import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminSessionsTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Sessões Ativas</h3>
      <p className={css.placeholderSubtitle}>
        Monitoramento de sessões ativas e capacidade de revogação remota.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
