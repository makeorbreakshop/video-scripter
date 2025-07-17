'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function TestSearchPage() {
  const [concept, setConcept] = useState('best cooking techniques');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(0.5);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/test-search-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, threshold, topK: 50 })
      });
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error('Search failed:', error);
      setResults({ error: 'Search failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Pinecone Search</h1>
      
      <div className="flex gap-2 mb-4">
        <Input
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Enter concept..."
          className="max-w-md text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
        />
        <Button onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </div>

      {results && (
        <div className="mt-4">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Results:</h2>
          <pre className="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-4 rounded overflow-auto">
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}