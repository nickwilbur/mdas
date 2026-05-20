// Pure post-processor for Glean MCP `chat` tool replies.
//
// Lives in its own file (no `server-only`, no Glean / DB imports) so
// vitest can unit-test it directly. The narrative wrapper in
// `forecast-narrative.ts` is server-only because it constructs a
// GleanClient; this helper just operates on the text Glean already
// returned.
//
// Why we need this at all (2026-05-20):
// The shared GleanClient.parseChatResult() in
// packages/adapters/read/_shared/src/glean.ts falls through to
// "treat as plain text" when Glean returns its YAML-style chat
// envelope (no `structuredContent`, no JSON `{reply}` envelope).
// Observed shape in the wild:
//
//     Q2 is flashing close to plan ...
//     ---
//     chatId: 28a69e3770ff4f208551911f2f1fad8f
//     messages[1]:
//       -
//         agentTraceInfo:
//           startTimeMillis: 1779318828581
//           traceId: 757092f7b90da44ffa6b5a1fb58cd31e
//         ts: "2026-05-20 23:13:50.747530071 +0000 UTC"
//         workflowRunId: 9e7c60ac91e74548a92d6f13bba390a7
//         workflowTraceId: 757092f7b90da44ffa6b5a1fb58cd31e
//
// Without trimming, the entire envelope leaks into the leadership
// churn-call doc.

/**
 * Strip the YAML-ish trace/metadata footer Glean's MCP chat tool
 * appends to assistant replies. Two layers:
 *
 *   1. Cut at the first standalone `---` line (YAML document
 *      separator). `^---$` only — never chops a hyphenated word or
 *      an inline em-dash.
 *   2. Defensive fallback: trim trailing YAML-ish metadata lines if
 *      Glean ever emits them without the `---` header (the format
 *      is unstable so we belt-and-suspenders this).
 *
 * Returns the trimmed narrative. Empty string when the entire reply
 * was metadata (or undefined / whitespace-only input).
 */
export function cleanGleanChatReply(raw: string | undefined): string {
  if (!raw) return '';
  let text = raw;
  // Primary: cut at the first standalone `---` line.
  const sepMatch = text.match(/(^|\n)---\s*\n/);
  if (sepMatch && sepMatch.index != null) {
    text = text.slice(0, sepMatch.index);
  }
  // Fallback: trim trailing metadata lines if no separator was emitted.
  const metaKeyRe =
    /(^|\n)\s*(chatId:|agentTraceInfo:|workflowRunId:|workflowTraceId:|messages\[\d+\]:|ts:\s*"\d)/;
  const metaMatch = text.match(metaKeyRe);
  if (metaMatch && metaMatch.index != null) {
    text = text.slice(0, metaMatch.index);
  }
  return text.trim();
}
