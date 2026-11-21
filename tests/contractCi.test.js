'use strict';

/**
 * CI contract registry freshness check (#636)
 *
 * Enforces that:
 *  1. contracts/registry.json exists and is valid
 *  2. At least one active entry exists for each network referenced in the registry
 *  3. The registry schema file exists alongside the registry
 *  4. No entry has a deployedAt date in the future (clock skew guard)
 *  5. abiVersion values follow semver
 *
 * This test runs as part of CI to catch a deploy that forgot to update the
 * registry, or a hand-edited registry.json that broke the schema.
 *
 * Unlike contractInterfaceRegistry.test.js, this test reads the REAL file
 * from disk — it is a liveness check, not a unit test.
 */

const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.resolve(__dirname, '../contracts/registry.json');
const SCHEMA_PATH   = path.resolve(__dirname, '../contracts/registry.schema.json');

const { loadRegistry, resolveContract } = require('../backend/src/services/contractRegistryService');

// Un-mock fs so we read the actual files.
jest.unmock('fs');

describe('CI — contracts/registry.json is present and valid', () => {
  test('contracts/registry.json exists on disk', () => {
    expect(fs.existsSync(REGISTRY_PATH)).toBe(true);
  });

  test('contracts/registry.schema.json exists on disk', () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  test('registry.json is valid JSON', () => {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('loadRegistry() validates successfully against the schema rules', () => {
    expect(() => loadRegistry()).not.toThrow();
    expect(Array.isArray(loadRegistry())).toBe(true);
  });
});

describe('CI — registry entries are semantically correct', () => {
  let registry;

  beforeAll(() => {
    registry = loadRegistry();
  });

  test('every network that appears in the registry has at least one active entry', () => {
    const networks = [...new Set(registry.map((e) => e.network))];
    for (const network of networks) {
      const active = registry.filter((e) => e.network === network && e.active);
      expect(active.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('no entry has a deployedAt date in the future', () => {
    const now = Date.now();
    for (const entry of registry) {
      const deployed = new Date(entry.deployedAt).getTime();
      expect(deployed).toBeLessThanOrEqual(now + 60_000); // 1-minute tolerance for clock drift
    }
  });

  test('every abiVersion follows semver (major.minor.patch)', () => {
    const semverRe = /^\d+\.\d+\.\d+$/;
    for (const entry of registry) {
      expect(entry.abiVersion).toMatch(semverRe);
    }
  });

  test('contractIds are unique across all entries', () => {
    const ids = registry.map((e) => e.contractId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('resolveContract returns a non-null result for each active network', () => {
    const networks = [...new Set(registry.filter((e) => e.active).map((e) => e.network))];
    for (const network of networks) {
      const result = resolveContract(registry, network);
      expect(result).not.toBeNull();
      expect(result.network).toBe(network);
    }
  });
});
