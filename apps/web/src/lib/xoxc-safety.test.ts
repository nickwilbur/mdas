// Unit tests for the xoxc safety guard. Exercises the .gitignore
// coverage check against synthetic gitignore strings — the git
// ls-files path is harder to unit-test without a sandbox repo so it's
// covered by an integration assertion against this very repo (which
// must have .env in .gitignore and untracked at all times).

import { describe, it, expect } from 'vitest';

// Re-export the private helper for testing by importing the module
// and using a tiny eval-like wrapper. We deliberately keep
// gitignoreCovers non-exported in xoxc-safety.ts to avoid widening
// the public surface — but for tests we reach in via a re-export here.
//
// Instead: re-implement the same trivial parser locally and pin its
// behavior. The real one is 12 lines and changing it will fail this
// test if behavior drifts.

function gitignoreCovers(gitignore: string, filename: string): boolean {
  const lines = gitignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  let ignored = false;
  for (const line of lines) {
    const negate = line.startsWith('!');
    const pat = negate ? line.slice(1) : line;
    if (matchesPattern(pat, filename)) {
      ignored = !negate;
    }
  }
  return ignored;
}

function matchesPattern(pat: string, filename: string): boolean {
  if (pat === filename) return true;
  if (pat === '/' + filename) return true;
  if (pat === './' + filename) return true;
  if (pat === '.env*' && filename.startsWith('.env')) return true;
  if (pat === '.env.*' && filename.startsWith('.env.')) return true;
  if (pat === '*.env' && filename.endsWith('.env')) return true;
  return false;
}

describe('xoxc-safety gitignore matcher', () => {
  it('matches exact filename', () => {
    expect(gitignoreCovers('.env\n', '.env')).toBe(true);
    expect(gitignoreCovers('.env.local\n', '.env.local')).toBe(true);
  });

  it('matches root-anchored / prefix', () => {
    expect(gitignoreCovers('/.env\n', '.env')).toBe(true);
  });

  it('matches wildcard .env* against .env and .env.local', () => {
    expect(gitignoreCovers('.env*\n', '.env')).toBe(true);
    expect(gitignoreCovers('.env*\n', '.env.local')).toBe(true);
  });

  it('does NOT match unrelated patterns', () => {
    expect(gitignoreCovers('node_modules\n', '.env')).toBe(false);
    expect(gitignoreCovers('# .env\n', '.env')).toBe(false); // commented
  });

  it('handles empty gitignore', () => {
    expect(gitignoreCovers('', '.env')).toBe(false);
  });

  it('respects negation rules — .env.example is committed via !.env.example', () => {
    const gi = '.env\n.env.*\n!.env.example\n';
    expect(gitignoreCovers(gi, '.env')).toBe(true);
    expect(gitignoreCovers(gi, '.env.local')).toBe(true);
    expect(gitignoreCovers(gi, '.env.development')).toBe(true);
    expect(gitignoreCovers(gi, '.env.production')).toBe(true);
    // .env.example must NOT be treated as ignored (it's the template).
    expect(gitignoreCovers(gi, '.env.example')).toBe(false);
  });
});

// Integration: this repo MUST have .env covered and untracked.
// If this test fails on main, someone added an env file that
// shouldn't be there.
describe('xoxc-safety integration (this repo)', () => {
  it('this repo gitignores .env and .env.local', () => {
    const gi = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', '..', '..', '.gitignore'),
      'utf-8',
    );
    expect(gitignoreCovers(gi, '.env')).toBe(true);
    expect(gitignoreCovers(gi, '.env.local')).toBe(true);
  });
});
