import { describe, expect, it } from 'vitest';
import { cleanGleanChatReply } from './clean-glean-chat-reply';

describe('cleanGleanChatReply', () => {
  it('returns empty string for undefined / empty input', () => {
    expect(cleanGleanChatReply(undefined)).toBe('');
    expect(cleanGleanChatReply('')).toBe('');
    expect(cleanGleanChatReply('   \n\n   ')).toBe('');
  });

  it('returns the input verbatim when no metadata footer is present', () => {
    const narrative =
      'Q2 is flashing close to plan and we modestly improved the read this week.';
    expect(cleanGleanChatReply(narrative)).toBe(narrative);
  });

  it('strips the standalone --- separator and everything after it (observed 2026-05-20)', () => {
    const raw = [
      'Q2 is flashing close to plan and we modestly improved the read this week.',
      '---',
      'chatId: 28a69e3770ff4f208551911f2f1fad8f',
      'messages[1]:',
      '  -',
      '    agentTraceInfo:',
      '      startTimeMillis: 1779318828581',
      '      traceId: 757092f7b90da44ffa6b5a1fb58cd31e',
      '    ts: "2026-05-20 23:13:50.747530071 +0000 UTC"',
      '    workflowRunId: 9e7c60ac91e74548a92d6f13bba390a7',
      '    workflowTraceId: 757092f7b90da44ffa6b5a1fb58cd31e',
    ].join('\n');
    expect(cleanGleanChatReply(raw)).toBe(
      'Q2 is flashing close to plan and we modestly improved the read this week.',
    );
  });

  it('handles a multi-sentence narrative preserved before the separator', () => {
    const narrative = [
      'Q2 is flashing close to plan with a manageable gap.',
      'The team modestly improved the read this week.',
      'Watch-item is concentration in three accounts that have not yet hedged.',
    ].join(' ');
    const raw = `${narrative}\n---\nchatId: abc\nworkflowRunId: xyz`;
    expect(cleanGleanChatReply(raw)).toBe(narrative);
  });

  it('falls back to trimming known metadata keys when no --- separator is present', () => {
    // Defensive — Glean's chat format is unstable; sometimes the
    // metadata block leaks without the YAML document separator.
    const raw =
      'Q2 is on track.\nchatId: abc123\nworkflowTraceId: deadbeef';
    expect(cleanGleanChatReply(raw)).toBe('Q2 is on track.');
  });

  it('does NOT chop on hyphens / em-dashes inside the narrative body', () => {
    // Triple-hyphen ONLY counts as a separator when it's on its own
    // line. Inline em-dashes or hyphenated phrases must pass through.
    const narrative =
      'Q2 is on track — the team is carrying a small gap to Plan but trending in the right direction.';
    expect(cleanGleanChatReply(narrative)).toBe(narrative);
  });

  it('returns empty when the entire reply is just the metadata footer', () => {
    const raw = [
      '---',
      'chatId: abc',
      'workflowRunId: xyz',
    ].join('\n');
    expect(cleanGleanChatReply(raw)).toBe('');
  });
});
