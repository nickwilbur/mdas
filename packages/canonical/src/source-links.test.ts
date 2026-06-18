import { describe, expect, it } from 'vitest';
import { dedupeSourceLinksByUrl } from './source-links.js';

const sfLink = {
  source: 'salesforce' as const,
  label: 'SFDC Account',
  url: 'https://zuora.my.salesforce.com/lightning/r/Account/001/view',
};
const gleanLink = {
  source: 'glean' as const,
  label: 'Account plan',
  url: 'https://docs.google.com/document/d/abc/edit',
};

describe('dedupeSourceLinksByUrl', () => {
  it('collapses repeated URLs in one array', () => {
    const bloated = Array.from({ length: 200 }, () => sfLink);
    expect(dedupeSourceLinksByUrl(bloated)).toHaveLength(1);
  });

  it('merges two arrays with URL dedupe', () => {
    const merged = dedupeSourceLinksByUrl([sfLink, gleanLink], [sfLink, gleanLink]);
    expect(merged).toHaveLength(2);
  });

  it('lets later links override labels for the same URL', () => {
    const merged = dedupeSourceLinksByUrl([sfLink], [{ ...sfLink, label: 'Updated' }]);
    expect(merged[0]?.label).toBe('Updated');
  });
});
