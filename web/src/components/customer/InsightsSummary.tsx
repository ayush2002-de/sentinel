// /web/src/components/customer/InsightsSummary.tsx
import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface InsightsData {
  totalSpent: number;
  averageTransaction: number;
  merchantCount: number;
  riskLevel: string;
}

export function InsightsSummary({ customerId }: { customerId: string }) {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInsights = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_URL}/api/insights/${customerId}/summary`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setInsights(data);
      } catch (err) {
        console.error('Error fetching insights:', err);
        setError('Failed to load insights');
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  }, [customerId]);

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 rounded-md">
        <h3 className="font-semibold">Spending Summary</h3>
        <p className="text-gray-500">Loading insights...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded-md">
        <h3 className="font-semibold text-red-800">Spending Summary</h3>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="p-4 bg-gray-50 rounded-md">
        <h3 className="font-semibold">Spending Summary</h3>
        <p className="text-gray-500">No insights available</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-50 rounded-md">
      <h3 className="font-semibold mb-4">Spending Summary</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-sm text-gray-600">Total Spent</p>
          <p className="text-lg font-bold">${(insights.totalSpent / 100).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Avg Transaction</p>
          <p className="text-lg font-bold">${(insights.averageTransaction / 100).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Unique Merchants</p>
          <p className="text-lg font-bold">{insights.merchantCount}</p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Risk Level</p>
          <p className={`text-lg font-bold ${
            insights.riskLevel === 'HIGH' ? 'text-red-600' :
            insights.riskLevel === 'MEDIUM' ? 'text-yellow-600' :
            'text-green-600'
          }`}>
            {insights.riskLevel}
          </p>
        </div>
      </div>
    </div>
  );
}