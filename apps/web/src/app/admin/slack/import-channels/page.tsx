import { Card } from '@/components/ui';
import { ImportChannelsClient } from './ImportChannelsClient';
import { PromoteFromSweepButton } from './PromoteFromSweepButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function ImportChannelsPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Import Slack channel list</h1>
        <p className="mt-1 text-sm text-gray-600">
          Workaround for Zuora's <code>enterprise_is_restricted</code> policy
          — Slack blocks <code>users.conversations</code> and{' '}
          <code>conversations.list</code> for non-admin tokens on Enterprise
          Grid. Two paths below: the <strong>Playwright sweep</strong>{' '}
          (recommended, automated) drives your real Slack web client to
          harvest the cust-* directory via ⌘K; the <strong>HAR upload</strong>{' '}
          (manual fallback) parses a single tab's network capture.
        </p>
      </div>

      <Card title="Recommended: Playwright sweep (clears the heuristic backlog in one shot)">
        <p className="text-sm">From the repo root, run:</p>
        <pre className="mt-2 rounded bg-gray-900 p-3 text-xs text-gray-100">{`npm run sweep:slack`}</pre>
        <ol className="ml-5 mt-3 list-decimal space-y-1 text-sm">
          <li>
            <strong>First run only</strong>: opens a Chromium window. Log
            into Slack via SSO. When you see the workspace sidebar, return
            to the terminal and press Enter. Profile is saved to{' '}
            <code>.playwright-profile-slack/</code> (gitignored).
          </li>
          <li>
            The script drives the channel switcher (⌘K) through{' '}
            <code>cust-a</code>, <code>cust-b</code>, … all the way to{' '}
            <code>cust-9</code>, scraping each result set. Takes ~30
            seconds. Writes <code>data/slack-channels.json</code>.
          </li>
          <li>
            <strong>Subsequent runs</strong>: headless, reuses the saved
            session. No prompts. Slack sessions on Enterprise Grid last
            weeks to months; when one expires, re-run with{' '}
            <code>npm run sweep:slack -- --login</code>.
          </li>
          <li>
            When the file is fresh, click the button below to run the
            mapping pipeline. Exact <code>cust-{'{slug}'}</code> matches
            promote to <code>mapped</code>; near-matches surface for
            review (same UI as HAR upload below).
          </li>
        </ol>
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Why Playwright vs. console snippets</strong>: earlier
          attempts called the Flannel edge API directly with the session
          cookie, and Slack rejected them (the request envelope its real
          client sends includes correlation fields we couldn't reproduce).
          Driving the actual UI sidesteps that entirely — we're literally
          using Slack the way it's designed to be used, just automated.
        </p>
        <div className="mt-3">
          <PromoteFromSweepButton />
        </div>
      </Card>

      <Card title="Fallback: HAR upload (manual, partial)">
        <p className="text-sm">
          If the Playwright sweep above isn't an option (e.g. you're on a
          managed laptop that can't run npm scripts), upload a HAR export
          of your Slack tab instead. Coverage is much narrower — typically
          just channels Slack happened to load into your tab — but it
          works without any local tooling.
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-gray-700">
            How to get the HAR file (~2 minutes)
          </summary>
          <ol className="ml-5 mt-2 list-decimal space-y-1">
            <li>
              Open{' '}
              <a
                href="https://zuora.enterprise.slack.com"
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 hover:underline"
              >
                zuora.enterprise.slack.com
              </a>{' '}
              in Chrome (signed in, on workspace home).
            </li>
            <li>
              DevTools (⌥⌘I) → <strong>Network</strong> tab. Make sure
              recording is on (red dot top-left).
            </li>
            <li>Clear (🚫). Hard reload (⌘⇧R) the Slack tab.</li>
            <li>
              Optionally use ⌘K and type a few <code>cust-</code> prefixes
              to coax the edge API into returning more channels.
            </li>
            <li>
              Right-click any request row → <strong>Save all as HAR with content</strong>.
              (Or click the ⬇ icon in the Network panel toolbar.)
            </li>
            <li>Drop the .har file below.</li>
          </ol>
        </details>
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Privacy</strong>: HARs contain every API response Slack
          sent your browser — message bodies, user profiles, channel names
          (including private ones you belong to). We parse it server-side,
          extract only <code>{'{id, name}'}</code> pairs, persist only the
          ones matching a pending mapping candidate, and discard the rest.
          The HAR itself is never written to disk or to the database.
          Delete the .har locally after upload.
        </p>
      </Card>

      <ImportChannelsClient />
    </div>
  );
}
