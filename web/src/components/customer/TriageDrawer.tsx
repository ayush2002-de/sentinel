// /web/src/components/customer/TriageDrawer.tsx
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useTriageStream } from '../../hooks/useTriageStream';
import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

const API_KEY = 'sentinel-dev-key';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Define props
interface TriageDrawerProps {
  alertId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TriageDrawer({ alertId, isOpen, onClose }: TriageDrawerProps) {
  const { status, traces, decision, error } = useTriageStream(alertId);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [alertData, setAlertData] = useState<any>(null);
  const [customerData, setCustomerData] = useState<any>(null);
  const [cardStatus, setCardStatus] = useState<string | null>(null);
  const [contactMessage, setContactMessage] = useState('');
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Reset local state when drawer opens with a new alert
  useEffect(() => {
    if (isOpen && alertId) {
      // Reset action-related state
      setActionStatus(null);
      setOtp('');
      setContactMessage('');
      setCreatedCaseId(null);
    }
  }, [isOpen, alertId]);

  // Focus trap and keyboard navigation
  useEffect(() => {
    if (isOpen) {
      // Store the previously focused element
      previousFocusRef.current = document.activeElement as HTMLElement;

      // Handle ESC key
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    } else {
      // Return focus to previous element when drawer closes
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    }
  }, [isOpen, onClose]);

  // Fetch alert and customer data when alertId changes
  useEffect(() => {
    if (!alertId) {
      setAlertData(null);
      setCustomerData(null);
      return;
    }

    const fetchAlertAndCustomer = async () => {
      try {
        // Fetch alert data to get customer_id and suspect_txn_id
        const alertResponse = await fetch(`${API_URL}/api/alerts?limit=50`);
        const alertsData = await alertResponse.json();
        const alert = alertsData.alerts.find((a: any) => a.id === alertId);

        if (alert) {
          setAlertData(alert);

          // Fetch customer data to get card_id and recent transactions
          const customerResponse = await fetch(`${API_URL}/api/customer/${alert.customer_id}/transactions?limit=1`);
          const customerTxns = await customerResponse.json();
          setCustomerData(customerTxns);

          // Fetch card status
          const cardId = customerTxns.items?.[0]?.card_id;
          if (cardId) {
            const cardResponse = await fetch(`${API_URL}/api/cards/${cardId}`, {
              headers: { 'X-API-Key': API_KEY }
            });
            if (cardResponse.ok) {
              const cardData = await cardResponse.json();
              setCardStatus(cardData.status);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching alert/customer data:', err);
      }
    };

    fetchAlertAndCustomer();
  }, [alertId]);

  const handleAction = async (action: 'FREEZE_CARD' | 'OPEN_DISPUTE') => {
    if (!alertId || !alertData || !customerData) return;

    // Get real IDs from alert/customer data
    const txnId = customerData.items?.[0]?.id || null;
    const cardId = customerData.items?.[0]?.card_id || null;
    const reasonCode = '10.4'; // Default Visa reason code for fraud

    if (!txnId || !cardId) {
      setActionStatus('Error: Missing transaction or card data');
      return;
    }

    setActionStatus(`Executing ${action}...`);
    
    try {
      let url = '';
      let body: any = {};

      if (action === 'FREEZE_CARD') {
        url = `${API_URL}/api/action/freeze-card`;
        body = { cardId, otp };
      } else if (action === 'OPEN_DISPUTE') {
        url = `${API_URL}/api/action/open-dispute`;
        body = { txnId, reasonCode };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
          'Idempotency-Key': uuidv4(), // Generate a unique key for every action
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      // Handle OTP request (403 with PENDING_OTP status)
      if (result.status === 'PENDING_OTP') {
        setActionStatus('OTP Required. Please enter code.');
        console.log('Dev OTP:', result._dev_otp); // Show OTP in console for testing
        return; // Don't throw error, just wait for OTP input
      }

      if (!response.ok) {
        // Handle 429 Rate Limit
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || '10';
          setActionStatus(`Rate limited. Please wait ${retryAfter}s.`);
        } else {
          throw new Error(result.error || 'Action failed');
        }
      } else {
        // Handle successful response
        setActionStatus(`${action} successful!`);
        // Store case ID for timeline display
        if (result.caseId) {
          setCreatedCaseId(result.caseId);
        }
        // Update card status locally
        if (action === 'FREEZE_CARD' && result.status === 'FROZEN') {
          setCardStatus('FROZEN');
        }
        // Don't auto-close so user can see the case ID in timeline
        setTimeout(() => {
          setActionStatus(`${action} completed. Case ID: ${result.caseId || 'N/A'}`);
        }, 1000);
      }
    } catch (err: any) {
      setActionStatus(`Error: ${err.message}`);
    }
  };

  const handleContactCustomer = async () => {
    if (!alertId || !alertData || !contactMessage.trim()) {
      setActionStatus('Error: Missing required data or message');
      return;
    }

    setActionStatus('Sending message to customer...');

    try {
      const response = await fetch(`${API_URL}/api/action/contact-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
          'Idempotency-Key': uuidv4(),
        },
        body: JSON.stringify({
          customerId: alertData.customer_id,
          alertId: alertId,
          message: contactMessage,
          channel: 'EMAIL',
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to contact customer');
      }

      setActionStatus('Customer contacted successfully!');
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setActionStatus(`Error: ${err.message}`);
    }
  };

  const handleMarkFalsePositive = async () => {
    if (!alertId) return;

    setActionStatus('Marking as false positive...');

    try {
      const response = await fetch(`${API_URL}/api/action/mark-false-positive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
          'Idempotency-Key': uuidv4(),
        },
        body: JSON.stringify({
          alertId: alertId,
          reason: 'Agent reviewed and deemed not suspicious',
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to mark false positive');
      }

      setActionStatus('Marked as false positive!');
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setActionStatus(`Error: ${err.message}`);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-overlayShow" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-[450px] bg-white shadow-lg
                                   focus:outline-none data-[state=open]:animate-contentShow flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <Dialog.Title className="text-xl font-bold">Triage Run</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-gray-600">
              Automated analysis for Alert: {alertId}
            </Dialog.Description>
          </div>

          {/* This is the polite live region for accessibility */}
          <div aria-live="polite" className="sr-only">
            {status === 'streaming' && 'Triage analysis is streaming.'}
            {status === 'completed' && 'Triage analysis complete.'}
            {status === 'error' && `Error: ${error}`}
          </div>

          {/* Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Status and Error */}
            {status === 'starting' && (
              <div className="flex items-center space-x-2 text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span>Starting triage...</span>
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-red-600 font-semibold">Error:</p>
                <p className="text-red-700 text-sm mt-1">{error}</p>
                {status === 'error' && (
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-2 text-sm text-red-600 underline hover:text-red-800"
                  >
                    Refresh page
                  </button>
                )}
              </div>
            )}

            {/* Streaming Traces */}
            <div className="space-y-2">
              <h4 className="font-semibold">Analysis Plan:</h4>
              {traces.length === 0 && status === 'streaming' && (
                <div className="flex items-center space-x-2 text-gray-500 text-sm">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                  <span>Waiting for backend response...</span>
                </div>
              )}
              <ul className="list-inside list-disc space-y-1 text-sm">
                {traces.map((trace, i) => (
                  <li key={i} className={trace.ok ? 'text-green-700' : 'text-orange-700'}>
                    {trace.step}: {trace.ok ? '✓ OK' : '✗ FAIL'} ({trace.duration_ms}ms)
                  </li>
                ))}
                {status === 'streaming' && !decision && traces.length > 0 && (
                  <li className="text-blue-600 flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                    <span>Processing...</span>
                  </li>
                )}
              </ul>
            </div>

            {/* Transaction Details */}
            {alertData && alertData.suspect_txn && (
              <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
                <h4 className="font-semibold text-gray-800 mb-2">
                  {decision?.decision.relatedTransactions && decision.decision.relatedTransactions.length > 1
                    ? 'Related Transactions:'
                    : 'Suspect Transaction:'}
                </h4>
                {decision?.decision.relatedTransactions && decision.decision.relatedTransactions.length > 1 ? (
                  <div className="space-y-3">
                    {decision.decision.relatedTransactions.map((txn: any, idx: number) => (
                      <div key={txn.id} className={`text-sm p-3 rounded ${idx === 0 ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-gray-200'}`}>
                        <p className="font-semibold text-gray-800 mb-1">
                          Transaction #{idx + 1} {idx === 0 ? '(Suspect)' : ''}
                        </p>
                        <div className="text-gray-700 space-y-1">
                          <p><strong>ID:</strong> <span className="font-mono text-xs">{txn.id}</span></p>
                          <p><strong>Merchant:</strong> {txn.merchant}</p>
                          <p><strong>Amount:</strong> ₹{(txn.amount_cents / 100).toFixed(2)}</p>
                          <p><strong>Timestamp:</strong> {new Date(txn.ts).toLocaleString()}</p>
                          <p><strong>Location:</strong> {txn.city}, {txn.country}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p><strong>Merchant:</strong> {alertData.suspect_txn.merchant}</p>
                    <p><strong>Amount:</strong> ₹{(alertData.suspect_txn.amount_cents / 100).toFixed(2)} ({alertData.suspect_txn.amount_cents} cents)</p>
                    <p><strong>Timestamp:</strong> {new Date(alertData.suspect_txn.ts).toLocaleString()}</p>
                    <p><strong>Location:</strong> {alertData.suspect_txn.city}, {alertData.suspect_txn.country}</p>
                    <p><strong>MCC:</strong> {alertData.suspect_txn.mcc}</p>
                  </div>
                )}
              </div>
            )}

            {/* Final Decision */}
            {decision && (
              <div className="mt-6 rounded-md border border-blue-200 bg-blue-50 p-4">
                <h3 className="text-lg font-bold text-blue-800">
                  Recommendation: {decision.decision.action.replace('_', ' ')}
                </h3>
                <p className="mt-2 text-sm text-blue-700">
                  <strong>Risk:</strong> {decision.risk}
                </p>
                <p className="mt-1 text-sm text-blue-700">
                  <strong>Reason:</strong> {decision.decision.reason}
                </p>
                {decision.decision.reasonCode && (
                  <p className="mt-1 text-sm text-blue-700">
                    <strong>Reason Code:</strong> {decision.decision.reasonCode} (Fraud - Card Absent Environment)
                  </p>
                )}
                {decision.decision.citations && decision.decision.citations.length > 0 && (
                  <div className="mt-3 border-t border-blue-300 pt-3">
                    <p className="text-sm font-semibold text-blue-800 mb-1">Knowledge Base Documentation:</p>
                    <ul className="space-y-1">
                      {decision.decision.citations.map((citation: any, idx: number) => (
                        <li key={idx} className="text-sm text-blue-700">
                          <span className="font-medium">📄 {citation.title}</span>
                          <p className="text-xs text-blue-600 ml-4 mt-0.5">{citation.extract}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            {createdCaseId && (
              <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4">
                <h4 className="font-semibold text-green-800 mb-2">Timeline</h4>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm">
                    <span className="text-green-600">✓</span>
                    <div>
                      <p className="font-medium text-green-800">Case Created</p>
                      <p className="text-xs text-green-700">Case ID: <span className="font-mono">{createdCaseId}</span></p>
                      <p className="text-xs text-green-600">{new Date().toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {decision && (
              <div className="mt-6 space-y-3 pt-4 border-t">
                <h4 className="font-semibold text-gray-700">Actions:</h4>

                {/* Card Status Display */}
                {cardStatus && (
                  <div className={`p-2 rounded text-sm font-medium ${
                    cardStatus === 'FROZEN' ? 'bg-red-100 text-red-800' :
                    cardStatus === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    Card Status: {cardStatus}
                  </div>
                )}

                {actionStatus && (
                  <p className="text-sm font-medium text-blue-600" role="status" aria-live="polite">
                    {actionStatus}
                  </p>
                )}

                {actionStatus === 'OTP Required. Please enter code.' && (
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="Enter 6-digit OTP"
                    className="w-full rounded border border-gray-300 p-2"
                    aria-label="Enter OTP code"
                    autoFocus
                  />
                )}

                <button
                  onClick={() => handleAction('FREEZE_CARD')}
                  disabled={cardStatus === 'FROZEN' || (!!actionStatus && !actionStatus.includes('OTP'))}
                  className="w-full rounded-md bg-yellow-500 px-4 py-2 text-yellow-900 font-semibold hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="Freeze customer's card"
                >
                  {cardStatus === 'FROZEN' ? 'Card Already Frozen' : 'Freeze Card'}
                </button>
                <button
                  onClick={() => handleAction('OPEN_DISPUTE')}
                  disabled={!!actionStatus}
                  className="w-full rounded-md bg-red-600 px-4 py-2 text-white font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="Open a dispute for this transaction"
                >
                  Open Dispute
                </button>

                {/* Contact Customer Section */}
                <div className="pt-2 space-y-2">
                  <label htmlFor="contactMessage" className="block text-sm font-medium text-gray-700">
                    Contact Customer:
                  </label>
                  <textarea
                    id="contactMessage"
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="Enter message to send to customer..."
                    rows={3}
                    className="w-full rounded border border-gray-300 p-2 text-sm"
                    disabled={!!actionStatus}
                    aria-label="Message to send to customer"
                  />
                  <button
                    onClick={handleContactCustomer}
                    disabled={!!actionStatus || !contactMessage.trim()}
                    className="w-full rounded-md bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Send message to customer"
                  >
                    Contact Customer
                  </button>
                </div>

                <button
                  onClick={handleMarkFalsePositive}
                  disabled={!!actionStatus}
                  className="w-full rounded-md bg-gray-100 px-4 py-2 text-gray-700 font-semibold hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="Mark this alert as a false positive"
                >
                  Mark as False Positive
                </button>
              </div>
            )}
          </div>
          {/* End of scrollable body */}

          {/* Close button - fixed position outside scrollable area */}
          <Dialog.Close asChild>
            <button
              ref={closeButtonRef}
              className="absolute right-4 top-4 rounded-full p-2 bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 z-10"
              aria-label="Close triage drawer"
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}