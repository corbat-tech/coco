/**
 * State Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateManager, getStateManager } from './store.js';
import type { ProjectState } from './types.js';

describe('State Manager', () => {
  let tempDir: string;
  let stateManager: ReturnType<typeof createStateManager>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'coco-state-test-'));
    stateManager = createStateManager();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('createStateManager', () => {
    it('should create a state manager', () => {
      const manager = createStateManager();
      expect(manager).toBeDefined();
      expect(manager.load).toBeDefined();
      expect(manager.save).toBeDefined();
    });
  });

  describe('load', () => {
    it('should return default state when file does not exist', async () => {
      const state = await stateManager.load(tempDir);
      expect(state.path).toBe(tempDir);
      expect(state.currentPhase).toBe('none');
      expect(state.completedPhases).toEqual([]);
    });

    it('should load existing state', async () => {
      const existingState: ProjectState = {
        path: tempDir,
        currentPhase: 'orchestrate',
        completedPhases: ['converge'],
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      
      await stateManager.save(existingState);
      const loaded = await stateManager.load(tempDir);
      
      expect(loaded.currentPhase).toBe('orchestrate');
      expect(loaded.completedPhases).toContain('converge');
    });
  });

  describe('save', () => {
    it('should save state to disk', async () => {
      const state: ProjectState = {
        path: tempDir,
        currentPhase: 'converge',
        completedPhases: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      
      await stateManager.save(state);
      const exists = await stateManager.exists(tempDir);
      expect(exists).toBe(true);
    });

    it('should create .coco directory if needed', async () => {
      const state: ProjectState = {
        path: tempDir,
        currentPhase: 'none',
        completedPhases: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      
      await stateManager.save(state);
      // Should not throw
      const loaded = await stateManager.load(tempDir);
      expect(loaded.path).toBe(tempDir);
    });
  });

  describe('exists', () => {
    it('should return false when state does not exist', async () => {
      const exists = await stateManager.exists(tempDir);
      expect(exists).toBe(false);
    });

    it('should return true when state exists', async () => {
      const state: ProjectState = {
        path: tempDir,
        currentPhase: 'none',
        completedPhases: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      
      await stateManager.save(state);
      const exists = await stateManager.exists(tempDir);
      expect(exists).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove state file', async () => {
      const state: ProjectState = {
        path: tempDir,
        currentPhase: 'none',
        completedPhases: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      
      await stateManager.save(state);
      await stateManager.clear(tempDir);
      
      const exists = await stateManager.exists(tempDir);
      expect(exists).toBe(false);
    });

    it('should not throw when clearing non-existent state', async () => {
      await expect(stateManager.clear(tempDir)).resolves.not.toThrow();
    });
  });

  describe('updatePhase', () => {
    it('should update current phase', async () => {
      await stateManager.updatePhase(tempDir, 'converge');
      const state = await stateManager.load(tempDir);
      expect(state.currentPhase).toBe('converge');
    });
  });

  describe('completePhase', () => {
    it('should mark phase as completed', async () => {
      await stateManager.completePhase(tempDir, 'converge');
      const state = await stateManager.load(tempDir);
      expect(state.completedPhases).toContain('converge');
    });

    it('should advance to next phase', async () => {
      await stateManager.completePhase(tempDir, 'converge');
      const state = await stateManager.load(tempDir);
      expect(state.currentPhase).toBe('orchestrate');
    });

    it('should not duplicate completed phases', async () => {
      await stateManager.completePhase(tempDir, 'converge');
      await stateManager.completePhase(tempDir, 'converge');
      const state = await stateManager.load(tempDir);
      expect(state.completedPhases.filter(p => p === 'converge').length).toBe(1);
    });
  });

  describe('getNextPhase', () => {
    it('should return next phase', async () => {
      await stateManager.updatePhase(tempDir, 'converge');
      const next = await stateManager.getNextPhase(tempDir);
      expect(next).toBe('orchestrate');
    });

    it('should return none for output phase', async () => {
      await stateManager.updatePhase(tempDir, 'output');
      const next = await stateManager.getNextPhase(tempDir);
      expect(next).toBe('none');
    });
  });

  describe('getSuggestion', () => {
    it('should suggest init for none phase', async () => {
      const suggestion = await stateManager.getSuggestion(tempDir);
      expect(suggestion).toContain('/init');
    });

    it('should suggest plan for converge phase', async () => {
      await stateManager.updatePhase(tempDir, 'converge');
      const suggestion = await stateManager.getSuggestion(tempDir);
      expect(suggestion).toContain('/plan');
    });

    it('should suggest build for orchestrate phase', async () => {
      await stateManager.updatePhase(tempDir, 'orchestrate');
      const suggestion = await stateManager.getSuggestion(tempDir);
      expect(suggestion).toContain('/build');
    });
  });

  describe('getStateManager singleton', () => {
    it('should return same instance', () => {
      const s1 = getStateManager();
      const s2 = getStateManager();
      expect(s1).toBe(s2);
    });
  });
});
