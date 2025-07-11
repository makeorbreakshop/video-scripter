'use client';

import { useState, useEffect } from 'react';

interface QuotaStatus {
  date: string;
  quota_used: number;
  quota_limit: number;
  quota_remaining: number;
  percentage_used: number;
}

interface QuotaCall {
  id: number;
  date: string;
  method: string;
  cost: number;
  description: string;
  job_id: string;
  created_at: string;
}

export default function QuotaDashboard() {
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null);
  const [recentCalls, setRecentCalls] = useState<QuotaCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuotaData();
    const interval = setInterval(fetchQuotaData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchQuotaData = async () => {
    try {
      const response = await fetch('/api/youtube/quota-status');
      if (!response.ok) throw new Error('Failed to fetch quota data');
      
      const data = await response.json();
      setQuotaStatus(data.status);
      setRecentCalls(data.todaysCalls?.slice(0, 20) || []);
    } catch (error) {
      console.error('Error fetching quota data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500';
    if (percentage >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getProgressTextColor = (percentage: number) => {
    if (percentage >= 90) return 'text-red-600';
    if (percentage >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading quota data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">YouTube API Quota Dashboard</h1>
        
        {/* Quota Status Card */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Daily Quota Usage</h2>
          
          {quotaStatus ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Used</span>
                <span className={`font-bold ${getProgressTextColor(quotaStatus.percentage_used)}`}>
                  {quotaStatus.quota_used.toLocaleString()} / {quotaStatus.quota_limit.toLocaleString()}
                </span>
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div 
                  className={`h-4 rounded-full transition-all duration-300 ${getProgressColor(quotaStatus.percentage_used)}`}
                  style={{ width: `${Math.min(quotaStatus.percentage_used, 100)}%` }}
                />
              </div>
              
              <div className="flex justify-between items-center text-sm text-gray-600">
                <span>{quotaStatus.percentage_used.toFixed(1)}% used</span>
                <span>{quotaStatus.quota_remaining.toLocaleString()} remaining</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{quotaStatus.quota_used.toLocaleString()}</div>
                  <div className="text-sm text-blue-600">Used Today</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{quotaStatus.quota_remaining.toLocaleString()}</div>
                  <div className="text-sm text-green-600">Remaining</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500">No quota data available</div>
          )}
        </div>

        {/* Recent API Calls */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Recent API Calls</h2>
          
          {recentCalls.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">Time</th>
                    <th className="px-4 py-2 text-left">Method</th>
                    <th className="px-4 py-2 text-left">Cost</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-left">Job ID</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.map((call) => (
                    <tr key={call.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600">
                        {new Date(call.created_at).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          call.method === 'search.list' ? 'bg-red-100 text-red-800' :
                          call.method === 'videos.list' ? 'bg-blue-100 text-blue-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {call.method}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono">
                        <span className={`${call.cost >= 100 ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
                          {call.cost}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600 truncate max-w-xs">
                        {call.description}
                      </td>
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs">
                        {call.job_id ? call.job_id.slice(0, 8) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500">No API calls recorded today</div>
          )}
        </div>

        {/* Quota Guidelines */}
        <div className="bg-white rounded-lg shadow-sm p-6 mt-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Quota Guidelines</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold text-gray-700 mb-2">API Costs</h3>
              <ul className="space-y-1 text-gray-600">
                <li>• channels.list: 1 unit</li>
                <li>• videos.list: 1 unit</li>
                <li>• search.list: 100 units</li>
                <li>• playlistItems.list: 1 unit</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-700 mb-2">Import Estimates</h3>
              <ul className="space-y-1 text-gray-600">
                <li>• Small channel (100 videos): ~5-10 units</li>
                <li>• Medium channel (1000 videos): ~25-50 units</li>
                <li>• Large channel (10000 videos): ~250-500 units</li>
                <li>• Search-heavy imports: Much higher</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}