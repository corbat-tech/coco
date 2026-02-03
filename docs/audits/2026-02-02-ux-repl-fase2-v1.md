# UX/REPL Audit - Fase 2 v1

**Fecha:** 2026-02-02
**Auditor:** Claude Opus 4.5
**Área:** UX/REPL
**Score Anterior (Fase 1):** 86/100
**Target:** 95/100

---

## Estado Actual

### Features Existentes

| Feature | Status | File | Notes |
|---------|--------|------|-------|
| Syntax highlighting | ✅ Implemented | renderer.ts | `highlightCode()` for JS/TS |
| Spinner with elapsed time | ✅ Implemented | spinner.ts | Shows seconds elapsed |
| Tool execution feedback | ✅ Implemented | renderer.ts | Icons, durations, previews |
| Slash commands | ✅ Implemented | commands/* | 10 commands |
| Token usage tracking | ✅ Implemented | cost.ts | `/cost` command |
| SIGINT handling | ✅ Implemented | index.ts | Graceful abort |
| Session management | ✅ Implemented | session.ts | In-memory state |

### Features Missing

| Feature | Priority | Effort | Impact |
|---------|----------|--------|--------|
| Auto-complete for commands | P1 | Medium | High |
| History persistence | P1 | Low | Medium |
| Markdown code blocks | P2 | Low | Medium |
| Theme support | P3 | Medium | Low |

---

## Gap Analysis

### P1s from Phase 1

1. **Syntax highlighting para código** - ✅ Already exists in `highlightCode()`
2. **Auto-complete para slash commands** - ❌ Not implemented
3. **History persistente entre sesiones** - ❌ Not implemented
4. **Better progress indicators** - ✅ Spinner shows elapsed time

### Current Coverage

- Input handler: 0% (readline hard to mock)
- Spinner: ~90% (added tests)
- Renderer: ~85% (added tests)
- Commands: 85-100% (added tests)
- Session: 100%

---

## Proposed Improvements

### 1. History Persistence (P1)
**Location:** `src/cli/repl/input/handler.ts`
**Change:** Save/load history from `~/.coco/history`

```typescript
// Save history on exit
// Load history on startup
```

### 2. Auto-complete for Commands (P1)
**Location:** `src/cli/repl/input/handler.ts`
**Change:** Add readline completer for `/` commands

```typescript
const completer = (line: string) => {
  if (line.startsWith('/')) {
    const commands = getAllCommands().map(c => '/' + c.name);
    const hits = commands.filter(c => c.startsWith(line));
    return [hits.length ? hits : commands, line];
  }
  return [[], line];
};
```

---

## Score Evaluation

| Criterio | Peso | Puntos | Notas |
|----------|------|--------|-------|
| Responsiveness | 25% | 23/25 | Good spinner, streaming |
| Feedback | 25% | 22/25 | Tool icons, durations |
| Error UX | 25% | 21/25 | Good error messages |
| Discoverability | 25% | 20/25 | /help exists, no autocomplete |

**Score v1: 86/100** (baseline = Phase 1 score)

---

## Implementation Plan

1. [ ] Add history persistence (~30 min)
2. [ ] Add command auto-complete (~45 min)
3. [ ] Update tests
4. [ ] Re-evaluate score

---

*Auditoría Fase 2 - UX/REPL v1*
