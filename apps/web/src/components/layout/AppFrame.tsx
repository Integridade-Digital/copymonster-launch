import React from 'react'
import './AppFrame.css'

interface AppFrameProps {
  title?: string
  children: React.ReactNode
  onClose?: () => void
}

export function AppFrame({ title = 'Plans & Billing', children, onClose }: AppFrameProps) {
  const handleClose = () => {
    if (onClose) {
      onClose()
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('copymonster:modal', { detail: null }))
    }
  }

  return (
    <div className="cm-app-frame">
      <header className="cm-app-topbar">
        <div className="cm-topbar-breadcrumb">
          <span className="cm-breadcrumb-brand">CopyMonster</span>
          <span className="cm-breadcrumb-sep">/</span>
          <span className="cm-breadcrumb-current">{title}</span>
        </div>
        <button
          type="button"
          className="cm-back-to-chat-btn"
          onClick={handleClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Voltar ao Chat
        </button>
      </header>
      <main className="cm-app-content">
        {children}
      </main>
    </div>
  )
}
