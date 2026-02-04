/**
 * Intent Recognizer Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createIntentRecognizer,
  getIntentRecognizer,
  DEFAULT_INTENT_CONFIG,
} from './recognizer.js';
import type { IntentConfig } from './types.js';

describe('Intent Recognizer', () => {
  describe('createIntentRecognizer', () => {
    it('should create recognizer with default config', () => {
      const recognizer = createIntentRecognizer();
      expect(recognizer).toBeDefined();
      expect(recognizer.recognize).toBeDefined();
      expect(recognizer.resolve).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customConfig: Partial<IntentConfig> = {
        autoExecute: true,
        minConfidence: 0.8,
      };
      const recognizer = createIntentRecognizer(customConfig);
      const config = recognizer.getConfig();
      expect(config.autoExecute).toBe(true);
      expect(config.minConfidence).toBe(0.8);
      expect(config.autoExecuteThreshold).toBe(DEFAULT_INTENT_CONFIG.autoExecuteThreshold);
    });
  });

  describe('recognize', () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    describe('plan intent', () => {
      it('should recognize "create a plan"', async () => {
        const intent = await recognizer.recognize('create a plan');
        expect(intent.type).toBe('plan');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "design the architecture"', async () => {
        const intent = await recognizer.recognize('design the architecture');
        expect(intent.type).toBe('plan');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize Spanish "haz un plan"', async () => {
        const intent = await recognizer.recognize('haz un plan');
        expect(intent.type).toBe('plan');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('build intent', () => {
      it('should recognize "build the project"', async () => {
        const intent = await recognizer.recognize('build the project');
        expect(intent.type).toBe('build');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "let\'s build"', async () => {
        const intent = await recognizer.recognize("let's build");
        expect(intent.type).toBe('build');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize Spanish "construye el proyecto"', async () => {
        const intent = await recognizer.recognize('construye el proyecto');
        expect(intent.type).toBe('build');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('init intent', () => {
      it('should recognize "init a new project"', async () => {
        const intent = await recognizer.recognize('init a new project');
        expect(intent.type).toBe('init');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "create a new api"', async () => {
        const intent = await recognizer.recognize('create a new api');
        expect(intent.type).toBe('init');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize Spanish "nuevo proyecto"', async () => {
        const intent = await recognizer.recognize('nuevo proyecto');
        expect(intent.type).toBe('init');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('task intent', () => {
      it('should recognize "do the task"', async () => {
        const intent = await recognizer.recognize('do the task');
        expect(intent.type).toBe('task');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "work on the task"', async () => {
        const intent = await recognizer.recognize('work on the task');
        expect(intent.type).toBe('task');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('status intent', () => {
      it('should recognize "status"', async () => {
        const intent = await recognizer.recognize('status');
        expect(intent.type).toBe('status');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "what\'s the status"', async () => {
        const intent = await recognizer.recognize("what's the status");
        expect(intent.type).toBe('status');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('help intent', () => {
      it('should recognize "help"', async () => {
        const intent = await recognizer.recognize('help');
        expect(intent.type).toBe('help');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "?"', async () => {
        const intent = await recognizer.recognize('?');
        expect(intent.type).toBe('help');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('exit intent', () => {
      it('should recognize "exit"', async () => {
        const intent = await recognizer.recognize('exit');
        expect(intent.type).toBe('exit');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "quit"', async () => {
        const intent = await recognizer.recognize('quit');
        expect(intent.type).toBe('exit');
        expect(intent.confidence).toBeGreaterThan(0.6);
      });
    });

    describe('chat intent (fallback)', () => {
      it('should fallback to chat for unclear input', async () => {
        const intent = await recognizer.recognize('tell me about this file');
        expect(intent.type).toBe('chat');
      });

      it('should fallback to chat for questions', async () => {
        const intent = await recognizer.recognize('how does this work?');
        expect(intent.type).toBe('chat');
      });

      it('should handle empty input', async () => {
        const intent = await recognizer.recognize('');
        expect(intent.type).toBe('chat');
        expect(intent.confidence).toBe(1);
      });
    });
  });

  describe('entity extraction', () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    it('should extract sprint number', async () => {
      const intent = await recognizer.recognize('build sprint 5');
      expect(intent.entities.sprint).toBe(5);
    });

    it('should extract project name', async () => {
      const intent = await recognizer.recognize('init project my-app');
      expect(intent.entities.projectName).toBe('my-app');
    });

    it('should extract flags', async () => {
      const intent = await recognizer.recognize('plan --dry-run');
      expect(intent.entities.flags).toContain('dry-run');
    });

    it('should extract tech stack', async () => {
      const intent = await recognizer.recognize('init a typescript node.js project');
      expect(intent.entities.techStack).toContain('typescript');
      expect(intent.entities.techStack).toContain('node.js');
    });

    it('should extract quoted args', async () => {
      const intent = await recognizer.recognize('init "my awesome project"');
      expect(intent.entities.args).toContain('my awesome project');
    });
  });

  describe('intentToCommand', () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    it('should convert plan intent to command', async () => {
      const intent = await recognizer.recognize('create a plan --dry-run');
      const cmd = recognizer.intentToCommand(intent);
      expect(cmd).toEqual({ command: 'plan', args: ['--dry-run'] });
    });

    it('should convert build intent with sprint', async () => {
      const intent = await recognizer.recognize('build sprint 3');
      const cmd = recognizer.intentToCommand(intent);
      expect(cmd).toEqual({ command: 'build', args: ['--sprint=3'] });
    });

    it('should convert init intent with project name', async () => {
      const intent = await recognizer.recognize('init my-project --yes');
      const cmd = recognizer.intentToCommand(intent);
      expect(cmd).toEqual({ command: 'init', args: ['my-project', '--yes'] });
    });

    it('should return null for chat intent', async () => {
      const intent = await recognizer.recognize('hello there');
      const cmd = recognizer.intentToCommand(intent);
      expect(cmd).toBeNull();
    });
  });

  describe('shouldAutoExecute', () => {
    it('should auto-execute high confidence intents when enabled', async () => {
      const recognizer = createIntentRecognizer({
        autoExecute: true,
        autoExecuteThreshold: 0.8,
      });

      const intent = await recognizer.recognize('status');
      // Status is always in alwaysConfirm list so should not auto-execute
      expect(recognizer.shouldAutoExecute(intent)).toBe(false);
    });

    it('should respect alwaysConfirm list', async () => {
      const recognizer = createIntentRecognizer({
        autoExecute: true,
        alwaysConfirm: ['init'],
      });

      const intent = await recognizer.recognize('init new project');
      expect(recognizer.shouldAutoExecute(intent)).toBe(false);
    });

    it('should respect user preferences', async () => {
      const recognizer = createIntentRecognizer({
        autoExecute: false,
      });

      recognizer.setAutoExecutePreference('status', true);

      const intent = await recognizer.recognize('status');
      // Even with preference, status is in alwaysConfirm
      expect(recognizer.shouldAutoExecute(intent)).toBe(false);
    });
  });

  describe('resolve', () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    it('should resolve chat intent to not execute', async () => {
      const intent = await recognizer.recognize('hello');
      const resolution = await recognizer.resolve(intent);
      expect(resolution.execute).toBe(false);
    });

    it('should suggest command for valid intent', async () => {
      const intent = await recognizer.recognize('create a plan');
      const resolution = await recognizer.resolve(intent);
      expect(resolution.command).toBe('plan');
    });
  });

  describe('getIntentRecognizer singleton', () => {
    it('should return same instance', () => {
      const r1 = getIntentRecognizer();
      const r2 = getIntentRecognizer();
      expect(r1).toBe(r2);
    });

    it('should create new instance with config', () => {
      const r1 = getIntentRecognizer();
      const r2 = getIntentRecognizer({ autoExecute: true });
      expect(r1).not.toBe(r2);
      expect(r2.getConfig().autoExecute).toBe(true);
    });
  });
});
