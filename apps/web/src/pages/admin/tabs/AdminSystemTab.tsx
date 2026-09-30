import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminSystemTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Configurações do Sistema</h3>
      <p className={css.placeholderSubtitle}>
        Parâmetros globais do servidor, feature flags e configurações de ambiente.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
