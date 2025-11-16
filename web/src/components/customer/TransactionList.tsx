// /web/src/components/customer/TransactionList.tsx
import { useRef, useEffect, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// Define the transaction type
interface Transaction {
  id: string;
  ts: string;
  merchant: string;
  amount_cents: number;
  currency: string;
}

// API configuration
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Real API fetch function
const fetchTransactions = async (customerId: string, cursor?: string | null)
  : Promise<{ items: Transaction[], nextCursor: string | null }> => {

  console.log(`Fetching transactions for customer ${customerId} with cursor: ${cursor}`);

  // Build the URL with query parameters
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '50');

  const url = `${API_URL}/api/customer/${customerId}/transactions?${params}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      items: data.items || [],
      nextCursor: data.nextCursor || null,
    };
  } catch (error) {
    console.error('Error fetching transactions:', error);
    // Return empty data on error
    return {
      items: [],
      nextCursor: null,
    };
  }
};


export function TransactionList({ customerId }: { customerId: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // The parent element for the virtualizer
  const parentRef = useRef<HTMLDivElement>(null);

  // --- Data Fetching Logic ---
  const loadMore = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);

    // Fetch from real API endpoint
    const { items, nextCursor: newCursor } = await fetchTransactions(customerId, nextCursor);

    setTransactions(prev => [...prev, ...items]);
    setNextCursor(newCursor);
    setHasMore(newCursor !== null);
    setIsLoading(false);
  };

  // Initial load
  useEffect(() => {
    setTransactions([]);
    setNextCursor(null);
    setHasMore(true);
    loadMore();
  }, [customerId]);

  // --- Virtualization Logic ---
  const rowVirtualizer = useVirtualizer({
    count: hasMore ? transactions.length + 1 : transactions.length, // +1 for loading spinner
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50, // Estimate 50px height per row
    overscan: 5,
  });

  // Infinite scroll trigger
  useEffect(() => {
    const [lastItem] = [...rowVirtualizer.getVirtualItems()].reverse();
    if (!lastItem) return;

    if (lastItem.index >= transactions.length - 1 && hasMore && !isLoading) {
      loadMore();
    }
  }, [
    rowVirtualizer.getVirtualItems(),
    transactions.length,
    hasMore,
    isLoading,
  ]);

  // --- Memoized Row Component ---
  // This is critical for performance ("memoized rows")
  const TransactionRow = memo(({ transaction }: { transaction: Transaction }) => {
    return (
      <div className="flex justify-between items-center">
        <span className="font-mono">{transaction.id}</span>
        <span>{transaction.merchant}</span>
        <span>${(transaction.amount_cents / 100).toFixed(2)}</span>
      </div>
    );
  });

  return (
    <div
      ref={parentRef}
      className="h-[600px] overflow-y-auto border rounded-md"
      style={{ contain: 'strict' } as React.CSSProperties} // Performance boost
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const isLoaderRow = virtualItem.index > transactions.length - 1;
          const transaction = transactions[virtualItem.index];

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="p-3 border-b"
            >
              {isLoaderRow
                ? hasMore ? 'Loading more...' : 'End of list.'
                : <TransactionRow transaction={transaction} />
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}