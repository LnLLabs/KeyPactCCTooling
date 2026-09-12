import { Link } from 'react-router-dom'

export function MissingSettingsBanner() {
  return (
    <p className="error settings-banner">
      Blockfrost is not configured in this browser.{' '}
      <Link to="/settings">Open Settings</Link> and save your project id before continuing.
    </p>
  )
}
