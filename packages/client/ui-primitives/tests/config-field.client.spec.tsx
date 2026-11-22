// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfigField, type ConfigFieldProps, isModelOrProviderField } from '../src/ConfigField.tsx'

afterEach(() => {
  cleanup()
  delete (globalThis as any).__DSH_AUTH__
})

it('shares controlled inputs and reset actions between generated and custom forms', () => {
  const props: ConfigFieldProps = {
    label: 'Timeout', value: '500', secret: false, choices: [], disabled: false,
    overridden: true, invalid: false,
    labels: { reset: 'Reset', inherited: 'Inherited', invalid: 'Invalid value' },
    onChange: vi.fn(), onReset: vi.fn(),
  }
  const view = render(<ConfigField {...props} />)
  fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '600' } })
  expect(props.onChange).toHaveBeenCalledWith('600')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(props.onReset).toHaveBeenCalledOnce()
  view.rerender(<ConfigField {...props} choices={['500', '600']} invalid />)
  expect(screen.getByRole('status').textContent).toBe('Invalid value')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '600' } })
  expect(props.onReset).toHaveBeenCalledTimes(2)
  expect(props.onChange).toHaveBeenCalledTimes(2)
  view.rerender(<ConfigField {...props} secret overridden={false} />)
  expect(screen.getByLabelText('Timeout').getAttribute('type')).toBe('password')
  fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: 'hidden' } })
  expect(props.onChange).toHaveBeenLastCalledWith('hidden')
  expect(screen.queryByRole('button')).toBeNull()
  view.rerender(<ConfigField {...props} secret disabled overridden={false} />)
  expect(screen.getByLabelText('Timeout').hasAttribute('disabled')).toBe(true)
})

it('identifies model and provider fields accurately', () => {
  expect(isModelOrProviderField('Model')).toBe(true)
  expect(isModelOrProviderField('Model Name')).toBe(true)
  expect(isModelOrProviderField('Provider')).toBe(true)
  expect(isModelOrProviderField('Provedor de LLM')).toBe(true)
  expect(isModelOrProviderField('API Key')).toBe(true)
  expect(isModelOrProviderField('DeepSeek API Key')).toBe(true)
  expect(isModelOrProviderField('Auth Token')).toBe(true)
  expect(isModelOrProviderField('Timeout')).toBe(false)
  expect(isModelOrProviderField('Max Tokens')).toBe(false)
})

it('hides model and provider fields for non-admin users', () => {
  ;(globalThis as any).__DSH_AUTH__ = { isAdmin: false }
  const props: ConfigFieldProps = {
    label: 'Model Selection', value: 'gpt-4o', secret: false, choices: [], disabled: false,
    overridden: false, invalid: false,
    labels: { reset: 'Reset', inherited: 'Inherited', invalid: 'Invalid value' },
    onChange: vi.fn(), onReset: vi.fn(),
  }
  const { container, rerender } = render(<ConfigField {...props} />)
  expect(container.firstChild).toBeNull()

  rerender(<ConfigField {...props} label="Provider API Key" secret />)
  expect(container.firstChild).toBeNull()

  rerender(<ConfigField {...props} label="Display Name" />)
  expect(container.firstChild).not.toBeNull()
})

it('renders model and provider fields for admin users', () => {
  ;(globalThis as any).__DSH_AUTH__ = { isAdmin: true }
  const props: ConfigFieldProps = {
    label: 'Model Selection', value: 'deepseek-chat', secret: false, choices: [], disabled: false,
    overridden: false, invalid: false,
    labels: { reset: 'Reset', inherited: 'Inherited', invalid: 'Invalid value' },
    onChange: vi.fn(), onReset: vi.fn(),
  }
  const { container } = render(<ConfigField {...props} />)
  expect(container.firstChild).not.toBeNull()
  expect(screen.getByLabelText('Model Selection')).toBeDefined()
})
