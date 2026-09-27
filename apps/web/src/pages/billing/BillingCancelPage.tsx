import React from 'react'
import { Link } from 'react-router-dom'
import './billing.css'

export function BillingCancelPage() {
  return (
    <div className="cm-billing-result-wrap">
      <div className="cm-billing-result-card">
        <div className="cm-billing-result-icon cm-billing-result-icon--cancel">
          <svg style={{ width: '36px', height: '36px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h1 className="cm-billing-result-title">Checkout Canceled</h1>
        <p className="cm-billing-result-desc">
          Your payment was not processed and no charges were made. You can return to our plans whenever you are ready to
          upgrade your AI multi-agent capabilities.
        </p>

        <div className="cm-billing-result-actions">
          <Link
            to="/billing"
            className="cm-plan-action-btn cm-plan-action-btn--primary"
            style={{ margin: 0, textDecoration: 'none' }}
          >
            Back to Plans
          </Link>
          <Link
            to="/"
            className="cm-plan-action-btn cm-plan-action-btn--secondary"
            style={{ margin: 0, textDecoration: 'none' }}
          >
            Go to Workspaces
          </Link>
        </div>
      </div>
    </div>
  )
}
