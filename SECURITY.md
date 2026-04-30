# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in KithLedger, please report it responsibly.

**Do not open public issues for security vulnerabilities.**

Instead, please email: **security@kithledger.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 5 business days
- **Fix timeline:** Depends on severity (Critical: 7 days, High: 30 days, Medium: 90 days)

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Disclosure Policy

We follow coordinated disclosure. Please allow up to 90 days for a patch before public disclosure.

## Security Measures

KithLedger implements the following security controls:

- bcrypt password hashing (cost factor 12)
- httpOnly/Secure/SameSite=Strict JWT cookies
- Short-lived access tokens (15 min) with refresh token rotation
- CSRF protection via double-submit cookie pattern
- Redis-backed rate limiting and account lockout
- Input sanitization via DOMPurify
- Content Security Policy headers
- SQL injection prevention via parameterized queries
- Log sanitization to prevent credential leakage
- Non-root Docker container execution
