/**
 * Tests for bash command pattern extraction
 */

import { describe, it, expect } from "vitest";
import { extractBashPattern, getTrustPattern, isBashCommandTrusted } from "./bash-patterns.js";

describe("extractBashPattern", () => {
  describe("simple commands", () => {
    it("should extract base command", () => {
      expect(extractBashPattern("curl google.com")).toBe("bash:curl");
      expect(extractBashPattern("ls -la")).toBe("bash:ls");
      expect(extractBashPattern("rm -rf /tmp")).toBe("bash:rm");
      expect(extractBashPattern("cat file.txt")).toBe("bash:cat");
      expect(extractBashPattern("echo hello")).toBe("bash:echo");
    });
  });

  describe("git subcommands", () => {
    it("should extract git subcommand", () => {
      expect(extractBashPattern("git commit -m 'foo'")).toBe("bash:git:commit");
      expect(extractBashPattern("git push origin main")).toBe("bash:git:push");
      expect(extractBashPattern("git status")).toBe("bash:git:status");
      expect(extractBashPattern("git log --oneline")).toBe("bash:git:log");
      expect(extractBashPattern("git diff HEAD~1")).toBe("bash:git:diff");
      expect(extractBashPattern("git stash pop")).toBe("bash:git:stash");
      expect(extractBashPattern("git checkout -b feature")).toBe("bash:git:checkout");
      expect(extractBashPattern("git rebase main")).toBe("bash:git:rebase");
      expect(extractBashPattern("git reset --hard HEAD")).toBe("bash:git:reset");
    });

    it("should not treat flags as subcommands", () => {
      expect(extractBashPattern("git --version")).toBe("bash:git");
      expect(extractBashPattern("git -h")).toBe("bash:git");
    });
  });

  describe("npm/pnpm/yarn subcommands", () => {
    it("should extract package manager subcommands", () => {
      expect(extractBashPattern("npm install lodash")).toBe("bash:npm:install");
      expect(extractBashPattern("npm list")).toBe("bash:npm:list");
      expect(extractBashPattern("npm test")).toBe("bash:npm:test");
      expect(extractBashPattern("pnpm add zod")).toBe("bash:pnpm:add");
      expect(extractBashPattern("pnpm build")).toBe("bash:pnpm:build");
      expect(extractBashPattern("yarn install")).toBe("bash:yarn:install");
      expect(extractBashPattern("yarn build")).toBe("bash:yarn:build");
    });

    it("should not treat flags as subcommands", () => {
      expect(extractBashPattern("npm -g")).toBe("bash:npm");
      expect(extractBashPattern("pnpm --version")).toBe("bash:pnpm");
    });
  });

  describe("docker subcommands", () => {
    it("should extract docker subcommands", () => {
      expect(extractBashPattern("docker run -it ubuntu")).toBe("bash:docker:run");
      expect(extractBashPattern("docker build .")).toBe("bash:docker:build");
      expect(extractBashPattern("docker ps")).toBe("bash:docker:ps");
      expect(extractBashPattern("docker-compose up -d")).toBe("bash:docker-compose:up");
      expect(extractBashPattern("docker-compose down")).toBe("bash:docker-compose:down");
    });
  });

  describe("other subcommand tools", () => {
    it("should extract cargo subcommands", () => {
      expect(extractBashPattern("cargo build --release")).toBe("bash:cargo:build");
      expect(extractBashPattern("cargo test")).toBe("bash:cargo:test");
    });

    it("should extract go subcommands", () => {
      expect(extractBashPattern("go build ./...")).toBe("bash:go:build");
      expect(extractBashPattern("go test ./...")).toBe("bash:go:test");
    });

    it("should extract pip subcommands", () => {
      expect(extractBashPattern("pip install flask")).toBe("bash:pip:install");
      expect(extractBashPattern("pip list")).toBe("bash:pip:list");
    });

    it("should extract brew subcommands", () => {
      expect(extractBashPattern("brew install node")).toBe("bash:brew:install");
      expect(extractBashPattern("brew update")).toBe("bash:brew:update");
    });

    it("should extract apt subcommands", () => {
      expect(extractBashPattern("apt install vim")).toBe("bash:apt:install");
      expect(extractBashPattern("apt-get update")).toBe("bash:apt-get:update");
    });

    it("should extract gradle subcommands", () => {
      expect(extractBashPattern("gradle build")).toBe("bash:gradle:build");
      expect(extractBashPattern("gradle test")).toBe("bash:gradle:test");
      expect(extractBashPattern("./gradlew clean")).toBe("bash:./gradlew:clean");
      expect(extractBashPattern("./gradlew build")).toBe("bash:./gradlew:build");
    });

    it("should extract mvn subcommands", () => {
      expect(extractBashPattern("mvn compile")).toBe("bash:mvn:compile");
      expect(extractBashPattern("mvn test")).toBe("bash:mvn:test");
      expect(extractBashPattern("./mvnw package")).toBe("bash:./mvnw:package");
      expect(extractBashPattern("./mvnw clean")).toBe("bash:./mvnw:clean");
    });

    it("should extract kubectl subcommands", () => {
      expect(extractBashPattern("kubectl get pods")).toBe("bash:kubectl:get");
      expect(extractBashPattern("kubectl describe pod my-pod")).toBe("bash:kubectl:describe");
      expect(extractBashPattern("kubectl logs my-pod")).toBe("bash:kubectl:logs");
      expect(extractBashPattern("kubectl apply -f deploy.yaml")).toBe("bash:kubectl:apply");
      expect(extractBashPattern("kubectl delete pod my-pod")).toBe("bash:kubectl:delete");
    });

    it("should extract gh subcommands", () => {
      expect(extractBashPattern("gh pr list")).toBe("bash:gh:pr");
      expect(extractBashPattern("gh issue view 123")).toBe("bash:gh:issue");
      expect(extractBashPattern("gh release create")).toBe("bash:gh:release");
    });

    it("should extract aws subcommands", () => {
      expect(extractBashPattern("aws s3 ls")).toBe("bash:aws:s3");
      expect(extractBashPattern("aws ec2 describe-instances")).toBe("bash:aws:ec2");
      expect(extractBashPattern("aws sts get-caller-identity")).toBe("bash:aws:sts");
      expect(extractBashPattern("aws cloudformation describe-stacks")).toBe(
        "bash:aws:cloudformation",
      );
    });
  });

  describe("sudo prefix", () => {
    it("should preserve sudo in pattern", () => {
      expect(extractBashPattern("sudo git commit")).toBe("bash:sudo:git:commit");
      expect(extractBashPattern("sudo rm -rf /")).toBe("bash:sudo:rm");
      expect(extractBashPattern("sudo apt install vim")).toBe("bash:sudo:apt:install");
      expect(extractBashPattern("sudo docker run ubuntu")).toBe("bash:sudo:docker:run");
    });

    it("should handle sudo alone", () => {
      expect(extractBashPattern("sudo")).toBe("bash:sudo");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      expect(extractBashPattern("")).toBe("bash:unknown");
    });

    it("should handle whitespace only", () => {
      expect(extractBashPattern("   ")).toBe("bash:unknown");
    });

    it("should handle extra whitespace", () => {
      expect(extractBashPattern("  git   commit  -m  'x'  ")).toBe("bash:git:commit");
    });

    it("should be case-insensitive for base command", () => {
      expect(extractBashPattern("GIT commit")).toBe("bash:git:commit");
      expect(extractBashPattern("NPM install")).toBe("bash:npm:install");
    });
  });
});

describe("getTrustPattern", () => {
  it("should extract bash pattern for bash_exec", () => {
    expect(getTrustPattern("bash_exec", { command: "git commit -m 'x'" })).toBe(
      "bash:git:commit",
    );
    expect(getTrustPattern("bash_exec", { command: "curl google.com" })).toBe("bash:curl");
    expect(getTrustPattern("bash_exec", { command: "npm install" })).toBe("bash:npm:install");
  });

  it("should extract bash pattern for bash_background", () => {
    expect(getTrustPattern("bash_background", { command: "npm run dev" })).toBe("bash:npm:run");
  });

  it("should return tool name for non-bash tools", () => {
    expect(getTrustPattern("write_file", { path: "/test.ts" })).toBe("write_file");
    expect(getTrustPattern("edit_file", { path: "/test.ts" })).toBe("edit_file");
    expect(getTrustPattern("delete_file")).toBe("delete_file");
    expect(getTrustPattern("git_push")).toBe("git_push");
  });

  it("should handle missing command input", () => {
    expect(getTrustPattern("bash_exec")).toBe("bash_exec");
    expect(getTrustPattern("bash_exec", {})).toBe("bash_exec");
    expect(getTrustPattern("bash_exec", { command: 123 })).toBe("bash_exec");
  });
});

describe("isBashCommandTrusted", () => {
  it("should match exact patterns", () => {
    const trusted = new Set(["bash:git:commit", "bash:curl"]);
    expect(isBashCommandTrusted("git commit -m 'x'", trusted)).toBe(true);
    expect(isBashCommandTrusted("curl google.com", trusted)).toBe(true);
  });

  it("should NOT match different subcommands", () => {
    const trusted = new Set(["bash:git:commit"]);
    expect(isBashCommandTrusted("git push origin main", trusted)).toBe(false);
    expect(isBashCommandTrusted("git rebase main", trusted)).toBe(false);
    expect(isBashCommandTrusted("git reset --hard", trusted)).toBe(false);
  });

  it("should NOT match base-only when subcommand patterns exist (security)", () => {
    const trusted = new Set(["bash:git"]);
    // bash:git only matches "git --version" etc. (no subcommand)
    expect(isBashCommandTrusted("git --version", trusted)).toBe(true);
    // It should NOT match subcommand variants
    expect(isBashCommandTrusted("git push origin main", trusted)).toBe(false);
    expect(isBashCommandTrusted("git commit -m 'x'", trusted)).toBe(false);
  });

  it("should not match when nothing is trusted", () => {
    const trusted = new Set<string>();
    expect(isBashCommandTrusted("git commit", trusted)).toBe(false);
  });

  it("should not match old-style bash_exec trust entries", () => {
    const trusted = new Set(["bash_exec"]);
    expect(isBashCommandTrusted("git commit", trusted)).toBe(false);
    expect(isBashCommandTrusted("curl google.com", trusted)).toBe(false);
  });
});
