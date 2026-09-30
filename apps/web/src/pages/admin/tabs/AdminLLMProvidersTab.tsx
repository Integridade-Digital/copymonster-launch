import css from '../../../components/layout/FooterActionsRoot.module.css'

export function AdminLLMProvidersTab() {
  return (
    <div className={css.placeholderContainer}>
      <span className={css.placeholderBadge}>Em breve</span>
      <h3 className={css.placeholderTitle}>Provedores LLM</h3>
      <p className={css.placeholderSubtitle}>
        Configuração de provedores de IA, chaves de API e políticas de balanceamento.
      </p>
      <div className={css.placeholderCard}>
        <p className={css.placeholderNotice}>Disponível após Bloco 6/7</p>
      </div>
    </div>
  )
}
