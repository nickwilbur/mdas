'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function AccountFilters({ fiscalQuarters }: { fiscalQuarters: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quartersParam = searchParams.get('quarters') || '';
  const selectedQuarters = quartersParam ? quartersParam.split(',') : [];

  const handleQuarterToggle = (quarter: string) => {
    const params = new URLSearchParams(searchParams.toString());
    let newSelected = [...selectedQuarters];
    
    if (quarter === 'all') {
      // Select all or deselect all
      if (selectedQuarters.length === fiscalQuarters.length) {
        newSelected = [];
      } else {
        newSelected = [...fiscalQuarters];
      }
    } else {
      if (newSelected.includes(quarter)) {
        newSelected = newSelected.filter(q => q !== quarter);
      } else {
        newSelected.push(quarter);
      }
    }
    
    if (newSelected.length > 0) {
      params.set('quarters', newSelected.join(','));
    } else {
      params.delete('quarters');
    }
    router.push(`/accounts?${params.toString()}`);
  };

  const allSelected = selectedQuarters.length === fiscalQuarters.length;

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Fiscal Quarter:</label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleQuarterToggle('all')}
            className={`px-3 py-1.5 text-sm rounded border ${
              allSelected 
                ? 'bg-blue-600 text-white border-blue-600' 
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            Select All
          </button>
          {fiscalQuarters.map(quarter => (
            <button
              key={quarter}
              onClick={() => handleQuarterToggle(quarter)}
              className={`px-3 py-1.5 text-sm rounded border ${
                selectedQuarters.includes(quarter)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {quarter}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
