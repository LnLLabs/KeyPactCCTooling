import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  clearSettings,
  DEFAULT_BLOCKFROST_API_URL,
  DEFAULT_CONSTITUTION_URL,
  DEFAULT_RATIONALE_URL,
  hasBlockfrostConfigured,
  saveSettings,
  settingsDefaultsForForm,
  type AppSettings,
} from '../cardano/settings'
import { clearConstitutionCache } from '../cardano/constitutionality'
import { useApp } from '../context/AppContext'

export function SettingsPage() {
  const { refreshSettings } = useApp()
  const [form, setForm] = useState<AppSettings>(() => settingsDefaultsForForm())
  const [showKeys, setShowKeys] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const configured = useMemo(() => hasBlockfrostConfigured(), [status])

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function onSave(event: FormEvent) {
    event.preventDefault()
    saveSettings(form)
    clearConstitutionCache()
    refreshSettings()
    setStatus('Saved locally in this browser. Values are not uploaded to the BSP host.')
  }

  function onClear() {
    clearSettings()
    clearConstitutionCache()
    setForm(settingsDefaultsForForm())
    refreshSettings()
    setStatus('Cleared local settings for this browser.')
  }

  function onResetDefaults() {
    setForm({
      ...form,
      blockfrostUrl: DEFAULT_BLOCKFROST_API_URL,
      rationaleUrl: DEFAULT_RATIONALE_URL,
      constitutionUrl: DEFAULT_CONSTITUTION_URL,
    })
    setStatus('Restored default URLs in the form (click Save to persist).')
  }

  return (
    <section className="panel">
      <h1>Settings</h1>
      <p className="lead">
        API keys and URLs are stored only in this browser&apos;s local storage so the public
        <code> cc.brothershipool.org </code>
        build contains no secrets. Paste Blockfrost and DeepSeek keys here yourself — they are not
        taken from the server. Anyone who can use this device profile can still read them.
      </p>

      {!configured && (
        <p className="error">
          Blockfrost project id is required before Register, Vote, or Library can talk to the chain.
        </p>
      )}

      <form className="settings-form" onSubmit={onSave}>
        <label>
          <span>Blockfrost project id</span>
          <input
            type={showKeys ? 'text' : 'password'}
            autoComplete="off"
            value={form.blockfrostProjectId}
            onChange={(event) => update('blockfrostProjectId', event.target.value)}
            placeholder="mainnet…"
            required
          />
        </label>

        <label>
          <span>Blockfrost API URL</span>
          <input
            type="url"
            value={form.blockfrostUrl}
            onChange={(event) => update('blockfrostUrl', event.target.value)}
            placeholder={
              import.meta.env.DEV
                ? 'Leave empty to use /blockfrost proxy in dev'
                : DEFAULT_BLOCKFROST_API_URL
            }
          />
        </label>

        <label>
          <span>DeepSeek API key</span>
          <input
            type={showKeys ? 'text' : 'password'}
            autoComplete="off"
            value={form.deepseekApiKey}
            onChange={(event) => update('deepseekApiKey', event.target.value)}
            placeholder="sk-…"
          />
        </label>

        <label>
          <span>Vote rationale URL (public HTTPS / IPFS gateway)</span>
          <input
            type="url"
            value={form.rationaleUrl}
            onChange={(event) => update('rationaleUrl', event.target.value)}
            placeholder={DEFAULT_RATIONALE_URL}
            required
          />
        </label>

        <label>
          <span>Constitution markdown URL</span>
          <input
            type="url"
            value={form.constitutionUrl}
            onChange={(event) => update('constitutionUrl', event.target.value)}
            placeholder={DEFAULT_CONSTITUTION_URL}
          />
        </label>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={showKeys}
            onChange={(event) => setShowKeys(event.target.checked)}
          />
          <span>Show secrets</span>
        </label>

        <div className="row">
          <button type="submit">Save</button>
          <button type="button" className="ghost-btn" onClick={onResetDefaults}>
            Reset default URLs
          </button>
          <button type="button" className="ghost-btn" onClick={onClear}>
            Clear all
          </button>
          <Link className="ghost-btn link-btn" to="/vote">
            Back to Vote
          </Link>
        </div>
      </form>

      {status && <p className="ok">{status}</p>}
    </section>
  )
}
