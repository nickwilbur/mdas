// Cerebro REST credential + base URL resolution.

const DEFAULT_BASE_URL = 'https://cerebro-mcp.corpdata.zuora.com';

/** Hostnames permitted for CEREBRO_BASE_URL (SSRF guard). */
const ALLOWED_HOST_SUFFIXES = ['.corpdata.zuora.com', '.zuora.com'] as const;

export interface CerebroRestCredentials {
  baseUrl: string;
  token: string;
}

export class CerebroConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CerebroConfigError';
  }
}

/** Validate base URL against known Cerebro hosts. */
export function assertAllowedCerebroBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CerebroConfigError(`CEREBRO_BASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new CerebroConfigError(
      `CEREBRO_BASE_URL must use https (or http://localhost for dev): ${raw}`,
    );
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'localhost' ||
    ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1));
  if (!allowed) {
    throw new CerebroConfigError(
      `CEREBRO_BASE_URL host "${host}" is not on the Cerebro allowlist`,
    );
  }
  return url.toString().replace(/\/$/, '');
}

export function readCerebroCredsFromEnv(): CerebroRestCredentials | null {
  const token = (process.env.CEREBRO_API_TOKEN ?? '').trim();
  if (!token) return null;
  const baseRaw = (process.env.CEREBRO_BASE_URL ?? DEFAULT_BASE_URL).trim();
  try {
    const baseUrl = assertAllowedCerebroBaseUrl(baseRaw);
    return { baseUrl, token };
  } catch {
    return null;
  }
}
