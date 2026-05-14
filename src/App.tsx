import { Navigate, Route, Routes } from 'react-router-dom'
import ApiKeysOnboardingBanner from './components/ApiKeysOnboardingBanner.tsx'
import CanvasPage from './components/CanvasPage/CanvasPage.tsx'
import HomePage from './components/HomePage/HomePage.tsx'
import SettingsPage from './components/SettingsPage/SettingsPage.tsx'

function App() {
  return (
    <>
      <ApiKeysOnboardingBanner />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/canvas/:projectId" element={<CanvasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
