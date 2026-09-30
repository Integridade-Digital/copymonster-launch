import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminUsersTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Gestão de Usuários</h3>
      <p className={css.placeholderSubtitle}>
        Administração global de contas, permissões de acesso e atribuição de papéis.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
