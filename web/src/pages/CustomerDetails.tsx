// /web/src/pages/CustomerDetail.tsx
import { useParams } from 'react-router-dom';
import { TransactionList } from '../components/customer/TransactionList';
import { InsightsSummary } from '../components/customer/InsightsSummary';

export function CustomerDetail() {
  const { id: customerId } = useParams();

  if (!customerId) {
    return <div>Error: No Customer ID provided.</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Customer Profile: {customerId}</h1>
      
      {/* This component fetches from /api/insights/:customerId/summary
        (which we built in Milestone 1) 
      */}
      <InsightsSummary customerId={customerId} />
      
      <h2 className="text-xl font-semibold">Transaction Timeline</h2>
      {/* This component fetches from /api/customer/:id/transactions
        (the keyset pagination endpoint from Milestone 1)
      */}
      <TransactionList customerId={customerId} />
    </div>
  );
}
