// /web/src/pages/Dashboard.tsx
import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface DashboardKPIs {
  alertsInQueue: number;
  alertsTriaged: number;
  disputesOpened: number;
  avgTriageLatency: number;
}

export function Dashboard() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchKPIs = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_URL}/api/dashboard/kpis`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setKpis(data);
      } catch (err) {
        console.error('Error fetching KPIs:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchKPIs();
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        <div className="text-center py-8">
          <p className="text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Alerts in Queue */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Alerts in Queue</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{kpis?.alertsInQueue || 0}</p>
            </div>
            <div className="bg-blue-100 rounded-full p-3">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Waiting for triage</p>
        </div>

        {/* Alerts Triaged */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Alerts Triaged</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{kpis?.alertsTriaged || 0}</p>
            </div>
            <div className="bg-green-100 rounded-full p-3">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Completed analysis</p>
        </div>

        {/* Disputes Opened */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Disputes Opened</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{kpis?.disputesOpened || 0}</p>
            </div>
            <div className="bg-yellow-100 rounded-full p-3">
              <svg
                className="w-6 h-6 text-yellow-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Active disputes</p>
        </div>

        {/* Avg Triage Latency */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Triage Latency</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {kpis?.avgTriageLatency || 0}
                <span className="text-lg text-gray-500 ml-1">ms</span>
              </p>
            </div>
            <div className="bg-purple-100 rounded-full p-3">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Processing speed</p>
        </div>
      </div>

      {/* Additional Information */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">System Overview</h2>
        <p className="text-gray-600">
          The dashboard displays real-time KPIs from your Sentinel Support system.
          Use the alerts queue to review and triage flagged transactions.
        </p>
        <div className="mt-4 flex gap-4">
          <a
            href="/alerts"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            View Alerts
          </a>
          <a
            href="/evals"
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
          >
            Run Evals
          </a>
        </div>
      </div>
    </div>
  );
}
