// /web/src/hooks/useTriageStream.ts
import { useState, useEffect, useRef } from 'react';

// --- Define Types ---

// A single trace event from the stream
export interface TriageTrace {
  step: string;
  ok: boolean;
  duration_ms: number;
  detail: any;
}

// The final decision event
export interface TriageDecision {
  decision: {
    action: 'FREEZE_CARD' | 'OPEN_DISPUTE' | 'NONE';
    reason: string;
    reasonCode?: string;
    citations: any[];
    relatedTransactions?: any[]; // For duplicate/pre-auth scenarios
  };
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
}

type TriageStatus = 'idle' | 'starting' | 'streaming' | 'completed' | 'error';

const API_KEY = 'sentinel-dev-key'; // Use the same dev key as the backend
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export function useTriageStream(alertId: string | null) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<TriageStatus>('idle');
  const [traces, setTraces] = useState<TriageTrace[]>([]);
  const [decision, setDecision] = useState<TriageDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Effect 1: Start the Triage Run ---
  // This runs when the component opens (alertId is set)
  useEffect(() => {
    if (!alertId) {
      // Reset state when drawer is closed
      setStatus('idle');
      setRunId(null);
      setTraces([]);
      setDecision(null);
      setError(null);
      return;
    }

    const startTriage = async () => {
      setStatus('starting');
      setError(null);
      setTraces([]);
      setDecision(null);
      
      try {
        const response = await fetch(`${API_URL}/api/triage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY,
          },
          body: JSON.stringify({ alertId }),
        });

        if (!response.ok) {
          throw new Error(`Failed to start triage: ${response.statusText}`);
        }

        const { runId } = await response.json();
        setRunId(runId);
        setStatus('streaming');
      } catch (err: any) {
        setError(err.message);
        setStatus('error');
      }
    };

    startTriage();
  }, [alertId]); // Re-run when the alert changes

  // --- Effect 2: Connect to the SSE Stream ---
  // This runs as soon as we get a runId
  useEffect(() => {
    if (status !== 'streaming' || !runId) {
      return; // Do nothing if not in streaming state
    }

    console.log(`[useTriageStream] Connecting to SSE for run: ${runId}`);
    const sseUrl = `${API_URL}/api/triage/${runId}/stream`;
    const eventSource = new EventSource(sseUrl);
    let hasReceivedData = false;

    // Add timeout - if no events received within 30 seconds, show error
    const timeout = setTimeout(() => {
      if (!hasReceivedData) {
        console.error('[useTriageStream] Timeout: No events received');
        setError('Triage is taking longer than expected. The backend might be processing...');
        setStatus('error');
        eventSource.close();
      }
    }, 30000); // 30 second timeout

    eventSource.onopen = () => {
      console.log(`[useTriageStream] SSE connection opened for run: ${runId}`);
    };

    // Listen for 'plan_built'
    eventSource.addEventListener('plan_built', (event) => {
      console.log('[useTriageStream] Plan built:', event.data);
      hasReceivedData = true;
      clearTimeout(timeout); // Got a response, clear timeout
    });

    // Listen for 'tool_update'
    eventSource.addEventListener('tool_update', (event) => {
      console.log('[useTriageStream] Tool update:', event.data);
      hasReceivedData = true;
      clearTimeout(timeout); // Got a response, clear timeout
      const trace = JSON.parse(event.data) as TriageTrace;
      setTraces((prevTraces) => [...prevTraces, trace]);
    });

    // Listen for 'decision_finalized'
    eventSource.addEventListener('decision_finalized', (event) => {
      console.log('[useTriageStream] Decision finalized:', event.data);
      hasReceivedData = true;
      clearTimeout(timeout); // Got a response, clear timeout
      const finalDecision = JSON.parse(event.data) as TriageDecision;
      setDecision(finalDecision);
      setStatus('completed');
      eventSource.close(); // We're done
    });

    // Handle errors
    eventSource.onerror = (err) => {
      clearTimeout(timeout);
      console.error('[useTriageStream] SSE Error:', err);
      setError('Streaming connection failed.');
      setStatus('error');
      eventSource.close();
    };

    // Cleanup function: close connection when component unmounts or runId changes
    return () => {
      console.log(`[useTriageStream] Cleanup: closing SSE for run: ${runId}`);
      clearTimeout(timeout);
      eventSource.close();
    };
  }, [runId, status]); // FIXED: Removed traces.length and decision from dependencies

  return { status, traces, decision, error };
}