# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Corbat-Coco, please report it responsibly:

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Email the details to [security@corbat.io](mailto:security@corbat.io)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

## Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: Within 24 hours
  - High: Within 7 days
  - Medium: Within 30 days
  - Low: Next release cycle

## Security Best Practices

When using Corbat-Coco, follow these security practices:

### API Keys

```bash
# Use environment variables for API keys
export ANTHROPIC_API_KEY="sk-ant-..."

# Never commit API keys to version control
# Add to .gitignore:
.env
.env.local
*.key
```

### Generated Code Security

Corbat-Coco generates code that may need security review:

1. **Always review generated code** before deploying to production
2. **Run security scanners** (e.g., `npm audit`, `snyk test`)
3. **Check for hardcoded secrets** in generated files
4. **Validate input handling** in generated endpoints

### File System Access

The CLI operates on your file system. Be aware:

1. The `coco build` command creates/modifies files
2. Generated code may include file operations
3. Review file paths in generated configurations

### Network Operations

Generated code may include network operations:

1. Review all external API calls
2. Validate URLs in generated configurations
3. Ensure proper HTTPS usage

## Security Features

### Built-in Protections

1. **Input Validation**: All configuration validated with Zod schemas
2. **No Eval**: Generated code avoids `eval()` and dynamic execution
3. **Dependency Audit**: Regular dependency security audits
4. **Type Safety**: TypeScript strict mode prevents many vulnerabilities

### Quality Checks

The quality system includes security scoring:

- Security dimension weight: 8%
- Checks for common vulnerabilities (OWASP Top 10)
- Enforces secure coding patterns

## Known Security Considerations

### API Key Storage

- API keys are read from environment variables
- Keys are not stored in configuration files
- Keys are not logged or transmitted beyond API calls

### Generated Code Review

- Generated code should always be reviewed
- Security patterns are enforced but not guaranteed
- Third-party integrations require manual security verification

### Checkpoint Data

- Checkpoints may contain project state
- Stored in `.coco/` directory
- Add `.coco/` to `.gitignore` if concerned about state exposure

## Vulnerability Disclosure

We follow responsible disclosure:

1. Reporter notifies us privately
2. We confirm and investigate
3. We develop and test a fix
4. We release the fix
5. We credit the reporter (if desired)
6. We publicly disclose after fix is available

## Security Updates

Security updates are distributed through:

1. npm package updates
2. GitHub Security Advisories
3. CHANGELOG.md entries marked with `[SECURITY]`

To receive notifications:

```bash
# Watch the repository
# Subscribe to security advisories on GitHub
# Use npm audit regularly
npm audit
```

## Contact

For security-related inquiries:

- Email: [security@corbat.io](mailto:security@corbat.io)
- GitHub Security Advisories: [Link](https://github.com/corbat/corbat-coco/security/advisories)

---

Thank you for helping keep Corbat-Coco secure!
