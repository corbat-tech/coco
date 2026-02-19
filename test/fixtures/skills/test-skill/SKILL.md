---
name: test-skill
description: A test skill for unit testing the skills system
version: "1.0.0"
license: MIT
metadata:
  author: corbat-team
  tags:
    - testing
    - example
  category: testing
---

# Test Skill Instructions

Always write tests before implementation (TDD).

## Example

```typescript
import { describe, it, expect } from "vitest";

describe("feature", () => {
  it("should work", () => {
    expect(true).toBe(true);
  });
});
```
