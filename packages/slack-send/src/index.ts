// Public surface of @mdas/slack-send.
//
// This package intentionally lives OUTSIDE packages/adapters/ because
// scripts/ci-guard.mjs enforces a read-only stance on the adapters tree
// (no write verbs, no send_/post_ tool names). The Slack send path is a
// genuine outbound write — gated by a hard env toggle and per-message
// confirmation — so it belongs in its own package with its own contract.

export { parseSlackUrl, isValidSlackChannelId } from './parse.js';
export type { ParsedSlackUrl } from './parse.js';

export { slugifyAccountName } from './slug.js';

export {
  computeMappingStatus,
  type MappingStatus,
  type MappingSource,
  type MappingStatusInput,
  type MappingStatusResult,
} from './status.js';

export {
  isSendEnabled,
  assertSendEnabled,
  getTestRecipient,
  SendDisabledError,
  type SendGateConfig,
  readSendGateConfigFromEnv,
} from './gate.js';

export {
  postMessage,
  type SlackPostInput,
  type SlackPostResult,
  SlackApiError,
} from './client.js';

export {
  fetchPublicChannelIndex,
  EMPTY_INDEX,
  type ChannelIndex,
  type SlackChannelSummary,
} from './list-channels.js';

export { validateChannelId, type ChannelValidation } from './validate-channel.js';
