import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminModelsTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Catálogo de Modelos</h3>
      <p className={css.placeholderSubtitle}>
        Gestão de modelos disponíveis, mapeamento de aliases e limites por plano.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
