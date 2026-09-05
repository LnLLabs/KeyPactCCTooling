import { NavLink, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { LibraryPage } from './pages/Library'
import { RegisterPage } from './pages/Register'
import { VotePage } from './pages/Vote'
import './App.css'

function Shell() {
  const { hotWallet, keypactName } = useApp()

  return (
    <div className="app">
      <header className="top">
        <div>
          <p className="brand">Keypact CC</p>
          <h1>Constitutional Committee tooling</h1>
        </div>
        <nav>
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/vote">Vote</NavLink>
          <NavLink to="/library">Library</NavLink>
        </nav>
        <div className="session">
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
