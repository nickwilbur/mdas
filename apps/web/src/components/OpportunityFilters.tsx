'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function OpportunityFilters({ fiscalYears }: { fiscalYears: number[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fy = searchParams.get('fy') || '';
  const q = searchParams.get('q') || '';

  const handleFYChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('fy', value);
    else params.delete('fy');
    router.push(`/opportunities?${params.toString()}`);
  };

  const handleQChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('q', value);
    else params.delete('q');
    router.push(`/opportunities?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Fiscal Year:</label>
        <select 
          value={fy} 
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          onChange={(e) => handleFYChange(e.target.value)}
        >
          <option value="">All</option>
          {fiscalYears.map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Quarter:</label>
        <select 
          value={q} 
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          onChange={(e) => handleQChange(e.target.value)}
        >
          <option value="">All</option>
          {['1', '2', '3', '4'].map(qtr => (
            <option key={qtr} value={qtr}>Q{qtr}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
