# MerchOS Auth Platform — Operational Runbook

## Common Issues and Troubleshooting

### Token Expired (401 Unauthorized)

**Symptoms**: API returns 401, frontend redirects to login unexpectedly.

**Diagnosis**:
1. Check if the access token TTL (60 min) has elapsed
2. Verify the session-manager's proactive refresh is running (55-min mark)
3. Check CloudWatch logs for refresh failures

**Resolution**:
- If refresh token is still valid (30-day TTL): client should retry refresh
- If refresh token is expired: user must re-authenticate
- If widespread: check Cognito User Pool health in AWS Console

```bash
# Check token validity
aws cognito-idp get-user --access-token <token> --region af-south-1
```

### MFA Locked Out

**Symptoms**: User cannot complete MFA challenge, locked out of account.

**Diagnosis**:
1. Check if the user's TOTP device is lost/reset
2. Verify MFA is actually enabled for the user

**Resolution**:
```bash
# Check user MFA settings
aws cognito-idp admin-get-user \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1

# Disable MFA for the user (admin action)
aws cognito-idp admin-set-user-mfa-preference \
  --user-pool-id <pool-id> \
  --username <email> \
  --software-token-mfa-settings Enabled=false,PreferredMfa=false \
  --region af-south-1
```

After disabling, the user can log in and re-enroll MFA via `POST /auth/mfa/setup`.

### Rate Limited (429 Too Many Requests)

**Symptoms**: User receives 429 responses, cannot perform auth operations.

**Diagnosis**:
1. Check rate-limits DynamoDB table for the user/IP
2. Review CloudWatch logs for `auth.security.rate-limit` events

**Resolution**:
- Standard case: wait for the window to expire (15 min for login, 60 min for forgot-password)
- Emergency unlock: delete the rate limit record from DynamoDB

```bash
# Check rate limit records for a user
aws dynamodb query \
  --table-name merch-os-rate-limits-dev \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk": {"S": "USER#<userId>"}}' \
  --region af-south-1

# Delete rate limit record (emergency only)
aws dynamodb delete-item \
  --table-name merch-os-rate-limits-dev \
  --key '{"PK": {"S": "IP#<ip-address>"}, "SK": {"S": "WINDOW#<window-id>"}}' \
  --region af-south-1
```

### Invalid Invitation Token

**Symptoms**: User clicks invitation link but gets "invalid or expired invitation" error.

**Diagnosis**:
1. Check invitation record in DynamoDB
2. Verify invitation hasn't expired (7-day TTL)
3. Check if invitation was revoked

```bash
aws dynamodb query \
  --table-name merch-os-invitations-dev \
  --key-condition-expression "PK = :pk AND SK = :sk" \
  --expression-attribute-values '{":pk": {"S": "TENANT#<tenantId>"}, ":sk": {"S": "INVITE#<email>"}}' \
  --region af-south-1
```

**Resolution**:
- If expired: tenant admin must re-send invitation
- If revoked: check with tenant admin why it was revoked
- If accepted: user already has an account, should use login

## User Management Operations

### Force Password Reset

```bash
# Force a user to reset their password on next login
aws cognito-idp admin-reset-user-password \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1
```

The user will receive an email with a reset code and must set a new password.

### Disable User Account

```bash
# Disable user (prevents login, keeps data)
aws cognito-idp admin-disable-user \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1

# Re-enable user
aws cognito-idp admin-enable-user \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1
```

### Unlock Account (After Too Many Failed Attempts)

Cognito's adaptive authentication may lock accounts after repeated failures.

```bash
# Check user status
aws cognito-idp admin-get-user \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1

# If status is RESET_REQUIRED or FORCE_CHANGE_PASSWORD:
aws cognito-idp admin-set-user-password \
  --user-pool-id <pool-id> \
  --username <email> \
  --password <temporary-password> \
  --permanent false \
  --region af-south-1
```

### Delete User Account

```bash
# Delete user permanently (irreversible)
aws cognito-idp admin-delete-user \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1
```

**Warning**: This is irreversible. Ensure tenant owner approval before proceeding. Owner accounts cannot be deleted via the API — this must be handled with extreme care.

### List All Users in a Tenant

```bash
# Via API (preferred — respects RBAC)
curl -H "Authorization: Bearer <token>" \
  "https://<api-url>/auth/users?tenantId=<tenantId>&limit=50"

# Direct Cognito query (admin)
aws cognito-idp list-users \
  --user-pool-id <pool-id> \
  --filter "custom:tenantId = \"<tenantId>\"" \
  --region af-south-1
```

## Token Rotation Procedures

### Rotate Cognito Signing Keys

Cognito automatically rotates signing keys. No manual action needed. If you suspect key compromise:

1. Navigate to Cognito Console → User Pool → Security → Advanced
2. Cognito rotates keys automatically; cached JWKS at API Gateway refreshes within minutes
3. Monitor for 401 spikes during rotation

### Refresh Token Revocation (Single User)

```bash
# Revoke all tokens for a specific user
aws cognito-idp admin-user-global-sign-out \
  --user-pool-id <pool-id> \
  --username <email> \
  --region af-south-1
```

### Refresh Token Revocation (All Users)

If a security incident requires revoking all active sessions:

1. **Do NOT rotate the user pool client secret** — this breaks all clients
2. Instead, iterate users and call global sign-out for affected accounts
3. Or update the Cognito app client to invalidate existing refresh tokens

```bash
# List all users and force sign-out (use with caution)
aws cognito-idp list-users --user-pool-id <pool-id> --region af-south-1 \
  | jq -r '.Users[].Username' \
  | while read user; do
      aws cognito-idp admin-user-global-sign-out \
        --user-pool-id <pool-id> \
        --username "$user" \
        --region af-south-1
    done
```

## Incident Response for Auth Failures

### Severity Levels

| Severity | Condition | Response Time |
|----------|-----------|---------------|
| P1 (Critical) | Complete auth outage, all users affected | Immediate |
| P2 (High) | Partial outage, specific tenant affected | 15 minutes |
| P3 (Medium) | Elevated failure rates, degraded performance | 1 hour |
| P4 (Low) | Isolated user issues, non-blocking | Next business day |

### P1: Complete Auth Outage

1. **Identify scope**: Check AWS Health Dashboard for Cognito issues in af-south-1
2. **Check API Gateway**: Verify the HTTP API is responding
3. **Check Lambda**: Look for Lambda throttling or errors in CloudWatch
4. **Communicate**: Notify stakeholders via incident channel
5. **Workaround**: If Cognito is down, consider serving cached sessions (read-only mode)

### P2: Elevated Failed Logins

1. **Check for credential stuffing**: Look for patterns in source IPs
2. **Review rate limit triggers**: Query EventBridge for `auth.security.rate-limit` events
3. **Block offending IPs**: Add to WAF deny list if applicable
4. **Notify affected tenants**: If targeted at specific accounts

```bash
# Query recent failed logins
aws logs filter-log-events \
  --log-group-name /aws/lambda/merch-os-auth-login \
  --filter-pattern "INVALID_CREDENTIALS" \
  --start-time $(date -d '-1 hour' +%s000) \
  --region af-south-1
```

### P3: Cross-Tenant Access Attempt

1. **Identify the user**: Check event details for userId and tenantId
2. **Assess intent**: Review the user's recent activity (accident vs malicious)
3. **Disable if malicious**: Use `admin-disable-user` immediately
4. **Audit data access**: Verify no data was leaked across tenant boundary
5. **Report**: File security incident report

```bash
# Query cross-tenant security events
aws events list-events \
  --event-bus-name merch-os-events-dev \
  --filter-pattern '{"detail-type": ["auth.security.cross-tenant"]}' \
  --region af-south-1
```

## Monitoring Alerts to Set Up

### CloudWatch Alarms

| Alarm | Metric | Threshold | Period | Action |
|-------|--------|-----------|--------|--------|
| HighFailedLogins | Login 401 count | > 50 | 5 min | SNS → on-call |
| AuthLambdaErrors | Lambda errors | > 5% error rate | 5 min | SNS → on-call |
| TokenRefreshFailures | Refresh 401 count | > 10% | 5 min | SNS → engineering |
| RateLimitExceeded | Rate limit events | > 100 | 1 min | SNS → security |
| HighLatency | Lambda duration p95 | > 3000ms | 5 min | SNS → engineering |
| CognitoThrottling | Cognito throttle count | > 10 | 1 min | SNS → engineering |

### EventBridge Rules

Set up rules to route security events to appropriate channels:

```json
{
  "source": ["merch-os.auth"],
  "detail-type": [
    "auth.security.rate-limit",
    "auth.security.cross-tenant",
    "auth.user.disabled"
  ]
}
```

Route to:
- SNS topic for security team notifications
- CloudWatch Logs for audit trail
- (Optional) Slack webhook for real-time alerts

## Cognito User Pool Maintenance

### Checking Pool Health

```bash
# Describe user pool
aws cognito-idp describe-user-pool \
  --user-pool-id <pool-id> \
  --region af-south-1

# Check estimated user count
aws cognito-idp describe-user-pool \
  --user-pool-id <pool-id> \
  --region af-south-1 \
  --query 'UserPool.EstimatedNumberOfUsers'
```

### Lambda Trigger Verification

```bash
# Verify triggers are configured correctly
aws cognito-idp describe-user-pool \
  --user-pool-id <pool-id> \
  --region af-south-1 \
  --query 'UserPool.LambdaConfig'
```

Expected triggers:
- PreSignUp → `merch-os-auth-pre-sign-up`
- PostConfirmation → `merch-os-auth-post-confirmation`
- PreTokenGeneration → `merch-os-auth-pre-token-generation`
- CustomMessage → `merch-os-auth-custom-message`

### Password Policy Check

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id <pool-id> \
  --region af-south-1 \
  --query 'UserPool.Policies.PasswordPolicy'
```

Expected:
- MinimumLength: 12
- RequireUppercase: true
- RequireLowercase: true
- RequireNumbers: true
- RequireSymbols: true

### DynamoDB Table Maintenance

Tables use TTL for automatic cleanup, but periodic checks are recommended:

```bash
# Check table status and item count
aws dynamodb describe-table --table-name merch-os-sessions-dev --region af-south-1 \
  --query 'Table.{Status:TableStatus,Items:ItemCount,Size:TableSizeBytes}'

# Verify TTL is enabled
aws dynamodb describe-time-to-live --table-name merch-os-sessions-dev --region af-south-1
```

### Useful CloudWatch Insights Queries

```
# Top users by login frequency (last 24h)
fields @timestamp, userId, email
| filter eventType = "auth.session.created"
| stats count() as logins by email
| sort logins desc
| limit 20

# Average login latency
fields @timestamp, @duration
| filter @message like /login/
| stats avg(@duration) as avgMs, pct(@duration, 95) as p95Ms, pct(@duration, 99) as p99Ms
| by bin(1h)

# Invitation acceptance rate
fields @timestamp, status
| filter eventType like /auth.user.invited/
| stats count() as total,
        sum(case when status = 'accepted' then 1 else 0 end) as accepted
| extend acceptRate = (accepted / total) * 100
```
