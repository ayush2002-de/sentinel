// /web/src/pages/Evals.tsx
import { useState, useEffect } from 'react';

// --- Define Types for the Report ---
interface EvalFailure {
  name: string;
  expected: any;
  actual: any;
  error?: string;
}

interface EvalReport {
  summary: {
    totalCases: number;
    passed: number;
    failed: number;
  };
  latency: {
    p50: string;
    p95: string;
  };
  failures: EvalFailure[];
}

export function Evals() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fetch the report from the /public folder
    fetch('/eval-report.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error('Eval report not found. Run `pnpm eval` in the /api folder first.');
        }
        return res.json();
      })
      .then((data: EvalReport) => {
        setReport(data);
      })
      .catch((err: any) => {
        setError(err.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // --- Render Logic ---

  if (isLoading) {
    return <div>Loading eval report...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 text-red-700 rounded-md">
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (!report) {
    return <div>No report data.</div>;
  }

  const { summary, latency, failures } = report;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Evaluation Results</h1>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard title="Total Cases" value={summary.totalCases} />
        <KpiCard title="Passed" value={summary.passed} className="bg-green-100 text-green-800" />
        <KpiCard title="Failed" value={summary.failed} className={summary.failed > 0 ? "bg-red-100 text-red-800" : ""} />
        <KpiCard title="Success Rate" value={`${((summary.passed / summary.totalCases) * 100).toFixed(1)}%`} />
      </div>

      {/* Latency */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard title="Agent Latency (p50)" value={`${latency.p50} ms`} />
        <KpiCard title="Agent Latency (p95)" value={`${latency.p95} ms`} />
      </div>

      {/* Failures List */}
      <div>
        <h2 className="text-xl font-semibold">Failures</h2>
        {failures.length === 0 ? (
          <p className="mt-2 text-green-600">All tests passed!</p>
        ) : (
          <div className="mt-4 space-y-4">
            {failures.map((fail, index) => (
              <div key={index} className="p-4 border border-red-200 rounded-md bg-white">
                <h3 className="font-bold text-red-700">{fail.name}</h3>
                {fail.error && <p className="text-sm text-red-600">Error: {fail.error}</p>}
                <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong className="font-medium">Expected:</strong>
                    <pre className="mt-1 p-2 bg-gray-50 rounded text-wrap">{JSON.stringify(fail.expected, null, 2)}</pre>
                  </div>
                  <div>
                    <strong className="font-medium">Actual:</strong>
                    <pre className="mt-1 p-2 bg-red-50 rounded text-wrap">{JSON.stringify(fail.actual, null, 2)}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// A simple reusable KPI card component
function KpiCard({ title, value, className = "" }: { title: string, value: string | number, className?: string }) {
  return (
    <div className={`p-4 bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}>
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
