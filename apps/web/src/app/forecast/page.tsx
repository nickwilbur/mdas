import { ForecastClient } from './ForecastClient';

export const dynamic = 'force-dynamic';

export default function ForecastPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Weekly Forecast Update</h1>
      <ForecastClient />
    </div>
  );
}
