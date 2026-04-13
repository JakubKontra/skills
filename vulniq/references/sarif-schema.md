# Vulniq SARIF Output Format

Vulniq outputs [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) (Static Analysis Results Interchange Format) for integration with GitHub Code Scanning, VS Code SARIF Viewer, and other tooling.

## Structure

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "vulniq",
          "version": "1.1.0",
          "informationUri": "https://github.com/JakubKontra/skills",
          "rules": []
        }
      },
      "results": [],
      "invocations": []
    }
  ]
}
```

## Rules Array

One entry per unique rule triggered:

```json
{
  "id": "SEC-001",
  "name": "HardcodedApiKey",
  "shortDescription": { "text": "Hardcoded API key detected in source code" },
  "helpUri": "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
  "defaultConfiguration": { "level": "error" },
  "properties": {
    "tags": ["security", "secrets", "owasp-a02"],
    "category": "secrets"
  }
}
```

## Results Array

One entry per finding instance:

```json
{
  "ruleId": "SEC-001",
  "level": "error",
  "message": {
    "text": "Google Maps API key hardcoded in environment file committed to git. Key: AIzaSy...2t8"
  },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": {
          "uri": "apps/crm/environments/.env.production",
          "uriBaseId": "%SRCROOT%"
        },
        "region": {
          "startLine": 6,
          "startColumn": 1
        }
      }
    }
  ],
  "fixes": [
    {
      "description": {
        "text": "Move API key to .env.local (gitignored). Rotate the compromised key. Add referrer restrictions in Google Cloud Console."
      }
    }
  ]
}
```

## Severity Mapping

| Vulniq Severity | SARIF Level |
|----------------|-------------|
| critical | `"error"` |
| high | `"error"` |
| medium | `"warning"` |
| low | `"note"` |
| info | `"none"` |

## Rule ID Ranges

| Prefix | Category |
|--------|----------|
| `SEC-001` – `SEC-099` | Secrets & Environment Files |
| `XSS-001` – `XSS-099` | Cross-Site Scripting |
| `HDR-001` – `HDR-099` | Security Headers |
| `PII-001` – `PII-099` | PII Exposure |
| `AUTH-001` – `AUTH-099` | Authentication |
| `DEP-001` – `DEP-099` | Dependencies |
| `OWA-001` – `OWA-099` | OWASP Patterns |
| `COR-001` – `COR-099` | CORS |
| `ERR-001` – `ERR-099` | Error Handling |
| `CHN-001` – `CHN-099` | Dependency Chain |
| `CUSTOM-001` – `CUSTOM-999` | Custom Patterns |

## Invocations

```json
{
  "executionSuccessful": true,
  "startTimeUtc": "2026-03-31T14:30:22.000Z",
  "endTimeUtc": "2026-03-31T14:32:15.000Z",
  "properties": {
    "checksEnabled": ["secrets", "xss", "securityHeaders", "auth"],
    "totalFindings": 15,
    "overallScore": 62,
    "overallGrade": "C"
  }
}
```
