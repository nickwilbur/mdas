import { describe, it, expect } from 'vitest';
import { computeMappingStatus } from './status.js';

const VALID = 'https://zuora.slack.com/archives/C0123ABCD';
const VALID2 = 'https://zuora.slack.com/archives/C9999ZZZZ';
const INVALID = 'https://zuora.slack.com/messages/general';

describe('computeMappingStatus', () => {
  it('mapped when SFDC URL parses', () => {
    const r = computeMappingStatus({ salesforceUrl: VALID, overrideUrl: null, cachedUrl: null });
    expect(r.status).toBe('mapped');
    expect(r.source).toBe('salesforce');
    expect(r.slackChannelId).toBe('C0123ABCD');
  });

  it('missing_salesforce_channel when nothing present', () => {
    const r = computeMappingStatus({ salesforceUrl: null, overrideUrl: null, cachedUrl: null });
    expect(r.status).toBe('missing_salesforce_channel');
    expect(r.slackUrl).toBeNull();
  });

  it('invalid_slack_url when SFDC URL does not parse', () => {
    const r = computeMappingStatus({ salesforceUrl: INVALID, overrideUrl: null, cachedUrl: null });
    expect(r.status).toBe('invalid_slack_url');
    expect(r.slackChannelId).toBeNull();
    expect(r.source).toBe('salesforce');
  });

  it('manually_overridden when override valid (override beats SFDC)', () => {
    const r = computeMappingStatus({ salesforceUrl: VALID, overrideUrl: VALID2, cachedUrl: null });
    expect(r.status).toBe('manually_overridden');
    expect(r.source).toBe('override');
    expect(r.slackChannelId).toBe('C9999ZZZZ');
  });

  it('invalid_slack_url when override unparseable (override still beats SFDC even when bad)', () => {
    const r = computeMappingStatus({ salesforceUrl: VALID, overrideUrl: INVALID, cachedUrl: null });
    expect(r.status).toBe('invalid_slack_url');
    expect(r.source).toBe('override');
  });

  it('falls back to cache when SFDC empty', () => {
    const r = computeMappingStatus({ salesforceUrl: null, overrideUrl: null, cachedUrl: VALID });
    expect(r.status).toBe('mapped');
    expect(r.source).toBe('cache');
    expect(r.statusReason).toMatch(/cached/i);
  });

  it('inaccessible_channel preserved even when URL parses', () => {
    const r = computeMappingStatus({
      salesforceUrl: VALID,
      overrideUrl: null,
      cachedUrl: null,
      knownInaccessible: true,
    });
    expect(r.status).toBe('inaccessible_channel');
    expect(r.slackChannelId).toBe('C0123ABCD');
  });

  it('inaccessible_channel does NOT override invalid_slack_url', () => {
    const r = computeMappingStatus({
      salesforceUrl: INVALID,
      overrideUrl: null,
      cachedUrl: null,
      knownInaccessible: true,
    });
    expect(r.status).toBe('invalid_slack_url');
  });

  it('sheet URL used when SFDC empty (source=sheet)', () => {
    const r = computeMappingStatus({
      salesforceUrl: null,
      overrideUrl: null,
      sheetUrl: VALID,
      cachedUrl: null,
    });
    expect(r.status).toBe('mapped');
    expect(r.source).toBe('sheet');
    expect(r.slackChannelId).toBe('C0123ABCD');
  });

  it('SFDC beats sheet', () => {
    const r = computeMappingStatus({
      salesforceUrl: VALID,
      overrideUrl: null,
      sheetUrl: VALID2,
      cachedUrl: null,
    });
    expect(r.source).toBe('salesforce');
  });

  it('override beats sheet', () => {
    const r = computeMappingStatus({
      salesforceUrl: null,
      overrideUrl: VALID,
      sheetUrl: VALID2,
      cachedUrl: null,
    });
    expect(r.source).toBe('override');
  });

  it('sheet invalid URL marked invalid (and source=sheet)', () => {
    const r = computeMappingStatus({
      salesforceUrl: null,
      overrideUrl: null,
      sheetUrl: INVALID,
      cachedUrl: null,
    });
    expect(r.status).toBe('invalid_slack_url');
    expect(r.source).toBe('sheet');
  });

  it('heuristic candidate used as last resort (not sendable, status=heuristic_candidate)', () => {
    const r = computeMappingStatus({
      salesforceUrl: null,
      overrideUrl: null,
      sheetUrl: null,
      cachedUrl: null,
      heuristicCandidateName: 'cust-acme',
    });
    expect(r.status).toBe('heuristic_candidate');
    expect(r.source).toBe('heuristic');
    expect(r.slackChannelId).toBeNull();
    expect(r.slackUrl).toBeNull();
    expect(r.derivedChannelName).toBe('cust-acme');
  });

  it('cache beats heuristic', () => {
    const r = computeMappingStatus({
      salesforceUrl: null,
      overrideUrl: null,
      sheetUrl: null,
      cachedUrl: VALID,
      heuristicCandidateName: 'cust-acme',
    });
    expect(r.source).toBe('cache');
    expect(r.status).toBe('mapped');
  });

  it('full precedence: override > sfdc > sheet > cache > heuristic', () => {
    expect(
      computeMappingStatus({
        salesforceUrl: VALID,
        overrideUrl: VALID2,
        sheetUrl: VALID,
        cachedUrl: VALID,
        heuristicCandidateName: 'cust-x',
      }).source,
    ).toBe('override');
    expect(
      computeMappingStatus({
        salesforceUrl: VALID,
        overrideUrl: null,
        sheetUrl: VALID2,
        cachedUrl: VALID,
        heuristicCandidateName: 'cust-x',
      }).source,
    ).toBe('salesforce');
    expect(
      computeMappingStatus({
        salesforceUrl: null,
        overrideUrl: null,
        sheetUrl: VALID,
        cachedUrl: VALID2,
        heuristicCandidateName: 'cust-x',
      }).source,
    ).toBe('sheet');
    expect(
      computeMappingStatus({
        salesforceUrl: null,
        overrideUrl: null,
        sheetUrl: null,
        cachedUrl: VALID,
        heuristicCandidateName: 'cust-x',
      }).source,
    ).toBe('cache');
    expect(
      computeMappingStatus({
        salesforceUrl: null,
        overrideUrl: null,
        sheetUrl: null,
        cachedUrl: null,
        heuristicCandidateName: 'cust-x',
      }).source,
    ).toBe('heuristic');
  });
});
