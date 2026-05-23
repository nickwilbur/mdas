import { describe, expect, it } from 'vitest';
import {
  BADGE_REGEX_SOURCE,
  TRAILING_BADGES,
  cleanChannelName,
} from './clean-channel-name.mts';

describe('cleanChannelName', () => {
  it('returns null for falsy / empty input', () => {
    expect(cleanChannelName(null)).toBeNull();
    expect(cleanChannelName(undefined)).toBeNull();
    expect(cleanChannelName('')).toBeNull();
    expect(cleanChannelName('   ')).toBeNull();
  });

  it('strips a leading hash and lowercases', () => {
    expect(cleanChannelName('#Cust-Foo')).toBe('cust-foo');
    expect(cleanChannelName('##cust-bar')).toBe('cust-bar');
  });

  it('strips the trailing "Enterprise" badge (the 66degrees bug)', () => {
    // This is the literal text our scraper saw — the channel is
    // `cust-66degrees` but Slack glued "Enterprise" to the end.
    expect(cleanChannelName('cust-66degreesEnterprise')).toBe('cust-66degrees');
    expect(cleanChannelName('cust-bamboohrEnterprise')).toBe('cust-bamboohr');
    expect(cleanChannelName('cust-a10-networksEnterprise')).toBe('cust-a10-networks');
  });

  it('strips the truncated "Enter" badge from CSS-ellipsified rows', () => {
    // Slack's narrow badge column truncates "Enterprise" → "Enter…".
    // The DOM text omits the ellipsis, so we see literally "enter" stuck
    // to the end. This is the actual data we observed in production.
    expect(cleanChannelName('cust-66degreesenter')).toBe('cust-66degrees');
    expect(cleanChannelName('cust-bamboohrenter')).toBe('cust-bamboohr');
    expect(cleanChannelName('cust-a10-networksenter')).toBe('cust-a10-networks');
    expect(cleanChannelName('cust-celartem-monotypeenter')).toBe('cust-celartem-monotype');
  });

  it('strips "External", "Private", "Archived", "Channel", and "Shared"', () => {
    expect(cleanChannelName('cust-acmeExternal')).toBe('cust-acme');
    expect(cleanChannelName('cust-acmePrivate')).toBe('cust-acme');
    expect(cleanChannelName('cust-acmeArchived')).toBe('cust-acme');
    expect(cleanChannelName('cust-acmeChannel')).toBe('cust-acme');
    expect(cleanChannelName('cust-acmeShared')).toBe('cust-acme');
  });

  it('strips multiple stacked badges (Enterprise + External)', () => {
    expect(cleanChannelName('cust-acmeEnterpriseExternal')).toBe('cust-acme');
  });

  it('preserves legitimate channel suffixes when the badge would follow a hyphen', () => {
    // Channel names use kebab-case so a real segment is always preceded
    // by `-`. Badge labels are glued on with NO separator. The lookbehind
    // requires the preceding char to be [a-z0-9] (not `-`), so these
    // legitimate names survive even though they end in badge-shaped text.
    expect(cleanChannelName('cust-acme-enter')).toBe('cust-acme-enter');
    expect(cleanChannelName('cust-acme-enterprise')).toBe('cust-acme-enterprise');
    expect(cleanChannelName('cust-acme-enterprises')).toBe('cust-acme-enterprises');
    expect(cleanChannelName('cust-acme-external')).toBe('cust-acme-external');
    expect(cleanChannelName('cust-acme-private')).toBe('cust-acme-private');
    expect(cleanChannelName('cust-acme-shared')).toBe('cust-acme-shared');
  });

  it('handles the whitespace-separated badge case', () => {
    // Some Slack UIs DO render the badge with separating whitespace.
    // We split on whitespace first, so the badge never gets concatenated.
    expect(cleanChannelName('cust-acme Enterprise')).toBe('cust-acme');
    expect(cleanChannelName('  #cust-acme  Archived  ')).toBe('cust-acme');
  });

  it('does not chop badge-shaped substrings that are not at end-of-string', () => {
    expect(cleanChannelName('cust-externalize')).toBe('cust-externalize');
    expect(cleanChannelName('cust-membership-co')).toBe('cust-membership-co');
  });

  it('returns the lowercase name unchanged for clean input', () => {
    expect(cleanChannelName('cust-foo-bar')).toBe('cust-foo-bar');
    expect(cleanChannelName('CUST-FOO-BAR')).toBe('cust-foo-bar');
  });

  it('keeps a bare badge as-is (no preceding char to anchor the lookbehind)', () => {
    // This case shouldn't happen in practice (the scraper requires a
    // Slack channel ID before keeping a row, and bare badges don't carry
    // one), but we want to document the behavior: the lookbehind is
    // intentional, so a string that IS only a badge survives the strip.
    expect(cleanChannelName('Enterprise')).toBe('enterprise');
    expect(cleanChannelName('#Enterprise')).toBe('enterprise');
  });
});

describe('BADGE_REGEX_SOURCE', () => {
  it('stays in lock-step with TRAILING_BADGES', () => {
    // The sweep script inlines this regex source into page.evaluate.
    // If somebody updates TRAILING_BADGES without rebuilding the source,
    // this test catches it.
    expect(BADGE_REGEX_SOURCE).toBe(`(?<=[a-z0-9])(?:${TRAILING_BADGES.join('|')})$`);
  });

  it('compiles to a valid case-insensitive regex', () => {
    const re = new RegExp(BADGE_REGEX_SOURCE, 'i');
    expect(re.test('cust-fooEnterprise')).toBe(true);
    expect(re.test('cust-foo-enterprise')).toBe(false); // preceded by `-`
    expect(re.test('cust-foo')).toBe(false); // no badge
  });
});
