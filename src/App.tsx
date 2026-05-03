import { Navigate, Route, Routes } from 'react-router-dom'
import CanvasPage from './components/CanvasPage/CanvasPage.tsx'
import HomePage from './components/HomePage/HomePage.tsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/canvas/:projectId" element={<CanvasPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
