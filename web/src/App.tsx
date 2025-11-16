// /web/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Alerts } from './pages/Alerts';
import { CustomerDetail } from './pages/CustomerDetails';
import { Evals } from './pages/Evals';
import { Layout } from './components/Layout';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="customer/:id" element={<CustomerDetail />} />
          <Route path="evals" element={<Evals />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;