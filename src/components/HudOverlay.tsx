interface HudOverlayProps {
  audioEnabled: boolean
  onToggleAudio: () => void
  cinema: boolean
  onToggleCinema: () => void
  onFocusFish: () => void
  focusId: string | null
  onExitFocus: () => void
}

/** HUD flutuante em glassmorphism — desaparece por completo no modo Cinema. */
export function HudOverlay({
  audioEnabled,
  onToggleAudio,
  cinema,
  onToggleCinema,
  onFocusFish,
  focusId,
  onExitFocus,
}: HudOverlayProps) {
  return (
    <div className={`hud ${cinema ? 'hud--cinema' : ''}`} aria-hidden={cinema}>
      <header className="hud__brand">
        <span className="hud__dot" />
        <div>
          <strong>OCEANO VIVO</strong>
          <small>ABZÛ × Procurando Nemo</small>
        </div>
      </header>

      <nav className="hud__controls" aria-label="Controles da cena">
        <button
          type="button"
          className={`hud__button ${audioEnabled ? 'is-active' : ''}`}
          onClick={onToggleAudio}
          title="Som ambiente subaquático"
        >
          <span aria-hidden="true">{audioEnabled ? '🔊' : '🔇'}</span>
          <span>Som {audioEnabled ? 'ligado' : 'desligado'}</span>
        </button>

        <button
          type="button"
          className={`hud__button ${focusId ? 'is-active' : ''}`}
          onClick={focusId ? onExitFocus : onFocusFish}
          title="Seguir um peixe com a câmera"
        >
          <span aria-hidden="true">🐠</span>
          <span>{focusId ? 'Sair do foco' : 'Focar em um peixe'}</span>
        </button>

        <button type="button" className="hud__button" onClick={onToggleCinema} title="Modo Cinema">
          <span aria-hidden="true">🎬</span>
          <span>{cinema ? 'Sair do Cinema' : 'Modo Cinema'}</span>
        </button>
      </nav>

      <p className="hud__hint">
        Arraste para olhar · role para aproximar · clique na água para alimentar · clique em um peixe para segui-lo
      </p>
    </div>
  )
}
