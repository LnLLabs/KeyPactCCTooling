import { NavLink, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { LibraryPage } from './pages/Library'
import { RegisterPage } from './pages/Register'
import { SettingsPage } from './pages/Settings'
import { VotePage } from './pages/Vote'
import './App.css'

function Shell() {
  const { hotWallet, keypactName, settingsReady } = useApp()

  return (
    <div className="app">
      <header className="top">
        <a className="brand-lockup" href="https://brothershipool.org/" target="_blank" rel="noreferrer">
          <img
            className="brand-logo"
            src="/branding/logo-white.png"
            alt="Brothership Pool"
            width={200}
            height={56}
          />
        </a>
        <div className="brand-copy">
          <p className="brand">BSP CC</p>
          <h1>Constitutional Committee tooling</h1>
        </div>
        <nav>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/vote">Vote</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="session">
          <span>{settingsReady ? 'Settings ready' : 'Settings incomplete'}</span>
          <span>{keypactName ? `Cold: ${keypactName}` : 'Keypact disconnected'}</span>
          <span>
            {hotWallet?.api ? `${hotWallet.name}: ${hotWallet.ccHotId}` : 'No hot wallet'}
          </span>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<RegisterPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/vote" element={<VotePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
