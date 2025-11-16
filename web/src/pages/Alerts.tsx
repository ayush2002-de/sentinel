// /web/src/pages/Alerts.tsx
import { useState, useEffect } from 'react';
import { TriageDrawer } from '../components/customer/TriageDrawer';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Alert {
  id: string;
  customer_id: string;
  risk: string;
  status: string;
  created_at: string;
  customer?: {
    id: string;
    name: string;
    email_masked: string;
  };
}

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAlert, setActiveAlert] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('NEW');

  useEffect(() => {
    const fetchAlerts = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        params.set('limit', '50');

        const response = await fetch(`${API_URL}/api/alerts?${params}`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setAlerts(data.alerts || []);
      } catch (err) {
        console.error('Error fetching alerts:', err);
        setError('Failed to load alerts');
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
  }, [statusFilter]);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Alerts Queue</h1>

        {/* Status Filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('NEW')}
            className={`px-4 py-2 rounded ${
              statusFilter === 'NEW'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            New
          </button>
          <button
            onClick={() => setStatusFilter('TRIAGED')}
            className={`px-4 py-2 rounded ${
              statusFilter === 'TRIAGED'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Triaged
          </button>
          <button
            onClick={() => setStatusFilter('CLOSED')}
            className={`px-4 py-2 rounded ${
              statusFilter === 'CLOSED'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Closed
          </button>
          <button
            onClick={() => setStatusFilter('')}
            className={`px-4 py-2 rounded ${
              statusFilter === ''
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-8">
          <p className="text-gray-500">Loading alerts...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {!loading && !error && alerts.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No alerts found</p>
        </div>
      )}

      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="flex justify-between items-center p-4 border rounded-md bg-white shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex-1">
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-gray-600">{alert.id}</span>
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded ${
                    alert.risk === 'HIGH'
                      ? 'bg-red-100 text-red-800'
                      : alert.risk === 'MEDIUM'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {alert.risk}
                </span>
                <span className="text-sm text-gray-500">{alert.status}</span>
              </div>
              <div className="mt-2 text-sm">
                <p>
                  <span className="text-gray-600">Customer:</span>{' '}
                  {alert.customer?.name || alert.customer_id}
                  {alert.customer?.email_masked && (
                    <span className="text-gray-500 ml-2">({alert.customer.email_masked})</span>
                  )}
                </p>
                <p className="text-gray-500">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveAlert(alert.id)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Open Triage
            </button>
          </div>
        ))}
      </div>

      {/* Triage Drawer */}
      <TriageDrawer
        key={activeAlert} // Force remount when alert changes
        alertId={activeAlert}
        isOpen={!!activeAlert}
        onClose={() => setActiveAlert(null)}
      />
    </div>
  );
}
