/**
 * Tests for Trust Store
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadTrustStore,
  saveTrustStore,
  isProjectTrusted,
  getProjectTrustLevel,
  addProjectTrust,
  removeProjectTrust,
  listTrustedProjects,
  canPerformOperation,
  createTrustStore,
  TRUST_STORE_PATH,
  type TrustStoreConfig,
} from './trust-store.js';

describe('Trust Store', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'trust-store-test-'));
    storePath = join(tempDir, 'trust.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadTrustStore', () => {
    it('should return default store when file does not exist', async () => {
      const store = await loadTrustStore(storePath);

      expect(store.version).toBe(1);
      expect(store.projects).toEqual({});
      expect(store.globalSettings.defaultApprovalLevel).toBe('write');
    });

    it('should load existing store', async () => {
      const existingStore: TrustStoreConfig = {
        version: 1,
        projects: {
          '/test/project': {
            path: '/test/project',
            approvedAt: '2024-01-01T00:00:00Z',
            approvalLevel: 'full',
            toolsTrusted: ['file', 'bash'],
            lastAccessed: '2024-01-02T00:00:00Z',
          },
        },
        globalSettings: {
          autoApproveReadOnly: true,
          defaultApprovalLevel: 'read',
        },
      };

      const { writeFile } = await import('node:fs/promises');
      await writeFile(storePath, JSON.stringify(existingStore), 'utf-8');

      const store = await loadTrustStore(storePath);

      expect(store.projects['/test/project']).toBeDefined();
      expect(store.projects['/test/project']?.approvalLevel).toBe('full');
      expect(store.globalSettings.autoApproveReadOnly).toBe(true);
    });
  });

  describe('saveTrustStore', () => {
    it('should save store to disk', async () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {},
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      await saveTrustStore(store, storePath);

      const content = await readFile(storePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.version).toBe(1);
      expect(parsed.globalSettings.defaultApprovalLevel).toBe('write');
    });
  });

  describe('isProjectTrusted', () => {
    it('should return true for trusted project', () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {
          '/test/project': {
            path: '/test/project',
            approvedAt: '2024-01-01T00:00:00Z',
            approvalLevel: 'write',
            toolsTrusted: [],
            lastAccessed: '2024-01-01T00:00:00Z',
          },
        },
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      expect(isProjectTrusted(store, '/test/project')).toBe(true);
    });

    it('should return false for untrusted project', () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {},
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      expect(isProjectTrusted(store, '/unknown/project')).toBe(false);
    });
  });

  describe('getProjectTrustLevel', () => {
    it('should return trust level', () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {
          '/test/project': {
            path: '/test/project',
            approvedAt: '2024-01-01T00:00:00Z',
            approvalLevel: 'full',
            toolsTrusted: [],
            lastAccessed: '2024-01-01T00:00:00Z',
          },
        },
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      expect(getProjectTrustLevel(store, '/test/project')).toBe('full');
    });

    it('should return null for untrusted project', () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {},
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      expect(getProjectTrustLevel(store, '/unknown')).toBeNull();
    });
  });

  describe('addProjectTrust', () => {
    it('should add new project trust', async () => {
      const store = await loadTrustStore(storePath);

      await addProjectTrust(store, '/new/project', 'write', ['file', 'bash'], storePath);

      const updated = await loadTrustStore(storePath);
      expect(updated.projects['/new/project']).toBeDefined();
      expect(updated.projects['/new/project']?.approvalLevel).toBe('write');
      expect(updated.projects['/new/project']?.toolsTrusted).toEqual(['file', 'bash']);
    });

    it('should update existing project trust', async () => {
      const store = await loadTrustStore(storePath);

      await addProjectTrust(store, '/project', 'read', [], storePath);
      await addProjectTrust(store, '/project', 'full', ['file'], storePath);

      const updated = await loadTrustStore(storePath);
      expect(updated.projects['/project']?.approvalLevel).toBe('full');
    });
  });

  describe('removeProjectTrust', () => {
    it('should remove project trust', async () => {
      const store = await loadTrustStore(storePath);
      await addProjectTrust(store, '/project', 'write', [], storePath);

      const removed = await removeProjectTrust(store, '/project', storePath);

      expect(removed).toBe(true);
      const updated = await loadTrustStore(storePath);
      expect(updated.projects['/project']).toBeUndefined();
    });

    it('should return false for non-existent project', async () => {
      const store = await loadTrustStore(storePath);

      const removed = await removeProjectTrust(store, '/unknown', storePath);

      expect(removed).toBe(false);
    });
  });

  describe('listTrustedProjects', () => {
    it('should list projects sorted by last accessed', () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {
          '/project/a': {
            path: '/project/a',
            approvedAt: '2024-01-01T00:00:00Z',
            approvalLevel: 'write',
            toolsTrusted: [],
            lastAccessed: '2024-01-01T00:00:00Z',
          },
          '/project/b': {
            path: '/project/b',
            approvedAt: '2024-01-01T00:00:00Z',
            approvalLevel: 'read',
            toolsTrusted: [],
            lastAccessed: '2024-01-03T00:00:00Z',
          },
        },
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      const list = listTrustedProjects(store);

      expect(list).toHaveLength(2);
      expect(list[0]?.path).toBe('/project/b'); // Most recent first
      expect(list[1]?.path).toBe('/project/a');
    });
  });

  describe('canPerformOperation', () => {
    const createStore = (level: string): TrustStoreConfig => ({
      version: 1,
      projects: {
        '/project': {
          path: '/project',
          approvedAt: '2024-01-01T00:00:00Z',
          approvalLevel: level as 'read' | 'write' | 'full',
          toolsTrusted: [],
          lastAccessed: '2024-01-01T00:00:00Z',
        },
      },
      globalSettings: {
        autoApproveReadOnly: false,
        defaultApprovalLevel: 'write',
      },
    });

    it('read level can only read', () => {
      const store = createStore('read');
      expect(canPerformOperation(store, '/project', 'read')).toBe(true);
      expect(canPerformOperation(store, '/project', 'write')).toBe(false);
      expect(canPerformOperation(store, '/project', 'execute')).toBe(false);
    });

    it('write level can read and write', () => {
      const store = createStore('write');
      expect(canPerformOperation(store, '/project', 'read')).toBe(true);
      expect(canPerformOperation(store, '/project', 'write')).toBe(true);
      expect(canPerformOperation(store, '/project', 'execute')).toBe(false);
    });

    it('full level can do everything', () => {
      const store = createStore('full');
      expect(canPerformOperation(store, '/project', 'read')).toBe(true);
      expect(canPerformOperation(store, '/project', 'write')).toBe(true);
      expect(canPerformOperation(store, '/project', 'execute')).toBe(true);
    });

    it('should return false for untrusted project', () => {
      const store: TrustStoreConfig = {
        version: 1,
        projects: {},
        globalSettings: {
          autoApproveReadOnly: false,
          defaultApprovalLevel: 'write',
        },
      };

      expect(canPerformOperation(store, '/unknown', 'read')).toBe(false);
    });
  });

  describe('createTrustStore', () => {
    it('should create manager with all methods', async () => {
      const uniqueId = `manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const managerPath = join(tempDir, `${uniqueId}.json`);
      const manager = createTrustStore(managerPath);

      await manager.init();
      
      // Clean slate for this test
      const testProject = `/unique-project-${uniqueId}`;
      expect(manager.isTrusted(testProject)).toBe(false);

      await manager.addTrust(testProject, 'write', ['file']);

      expect(manager.isTrusted(testProject)).toBe(true);
      expect(manager.getLevel(testProject)).toBe('write');
      expect(manager.can(testProject, 'read')).toBe(true);
      expect(manager.can(testProject, 'write')).toBe(true);
      expect(manager.can(testProject, 'execute')).toBe(false);

      // Verify this specific project is in the list
      const list = manager.list();
      const found = list.find(p => p.path === testProject);
      expect(found).toBeDefined();
      expect(found?.approvalLevel).toBe('write');

      await manager.removeTrust(testProject);
      expect(manager.isTrusted(testProject)).toBe(false);
    });

    it('should manage settings', async () => {
      const managerPath = join(tempDir, `settings-test-${Date.now()}.json`);
      const manager = createTrustStore(managerPath);
      await manager.init();

      const settings = manager.getSettings();
      expect(settings.defaultApprovalLevel).toBe('write');

      await manager.updateSettings({ defaultApprovalLevel: 'read' });

      const updated = manager.getSettings();
      expect(updated.defaultApprovalLevel).toBe('read');
    });

    it('should throw if not initialized', () => {
      const managerPath = join(tempDir, `uninit-test-${Date.now()}.json`);
      const manager = createTrustStore(managerPath);

      expect(() => manager.isTrusted('/project')).toThrow('not initialized');
    });

    it('should update last accessed', async () => {
      const managerPath = join(tempDir, `touch-test-${Date.now()}.json`);
      const manager = createTrustStore(managerPath);
      await manager.init();

      await manager.addTrust('/project', 'write');
      const before = manager.list()[0]?.lastAccessed;

      await new Promise((r) => setTimeout(r, 10)); // Small delay
      await manager.touch('/project');

      const after = manager.list()[0]?.lastAccessed;
      expect(after).not.toBe(before);
    });
  });
});
