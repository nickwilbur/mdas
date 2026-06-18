import { describe, expect, it } from 'vitest';
import { resolveCseSlackOwner } from './slack-owners.js';

describe('resolveCseSlackOwner', () => {
  it('corrects Mahalakshmi Krishnan SFDC id to Maha', () => {
    const owner = resolveCseSlackOwner('005Po000008o45VIAQ', 'Mahalakshmi Krishnan');
    expect(owner).toEqual({
      name: 'Mahalakshmi S',
      slack_handle: 'Maha',
      role: 'CSE',
    });
  });

  it('corrects by display name when SFDC id is missing', () => {
    const owner = resolveCseSlackOwner(null, 'Mahalakshmi Krishnan');
    expect(owner?.slack_handle).toBe('Maha');
    expect(owner?.name).toBe('Mahalakshmi S');
  });

  it('passes through unknown CSE names unchanged', () => {
    const owner = resolveCseSlackOwner('0054u000007AypRAAS', 'Sneha Stephen');
    expect(owner).toEqual({ name: 'Sneha Stephen', role: 'CSE' });
  });

  it('returns null when no name', () => {
    expect(resolveCseSlackOwner('005Po000008o45VIAQ', null)).toBeNull();
  });
});
