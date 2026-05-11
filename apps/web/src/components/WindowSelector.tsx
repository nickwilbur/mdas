'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

const OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const;

export function WindowSelector({ current }: { current: number }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === '7') {
        params.delete('window');
      } else {
        params.set('window', value);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-medium text-gray-500">Window:</span>
      {OPTIONS.map((opt) => {
        const active = String(current) === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            className={`rounded-full px-2.5 py-0.5 font-medium transition-colors ${
              active
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
