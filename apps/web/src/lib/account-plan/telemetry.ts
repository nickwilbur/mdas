export function logAccountPlanTelemetry(
  msg: string,
  meta: Record<string, unknown>,
): void {
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'info',
      msg,
      service: 'web',
      ...meta,
    }),
  );
}
