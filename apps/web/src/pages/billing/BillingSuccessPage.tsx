import React from 'react'
import { Link } from 'react-router-dom'
import './billing.css'

export function BillingSuccessPage() {
  return (
    <div className="cm-billing-result-wrap">
      <div className="cm-billing-result-card">
        <div className="cm-billing-result-icon cm-billing-result-icon--success">
          <svg style={{ width: '36px', height: '36px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="cm-billing-result-title">Subscription Confirmed!</h1>
        <p className="cm-billing-result-desc">
          Thank you for subscribing to CopyMonster. Your account and workspaces have been updated with your new plan limits
          and autonomous AI multi-agent capacity.
        </p>

        <div className="cm-billing-result-actions">
          <Link
            to="/"
            className="cm-plan-action-btn cm-plan-action-btn--primary"
            style={{ margin: 0, textDecoration: 'none' }}
          >
            Go to Workspaces
          </Link>
          <Link
            to="/billing"
            className="cm-plan-action-btn cm-plan-action-btn--secondary"
            style={{ margin: 0, textDecoration: 'none' }}
          >
            View Plan Details
          </Link>
        </div>
      </div>
    </div>
  )
}
