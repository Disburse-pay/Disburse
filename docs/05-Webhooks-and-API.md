# Webhooks and API

Disburse provides webhooks and an API to integrate with external systems.

## Webhooks

You can register webhook endpoints that receive POST notifications whenever a new Portable Settlement Proof (PSP) is issued.

### Security

Each delivery is signed with HMAC-SHA256. The receiver can verify the payload's authenticity using the `X-Disburse-Signature` header.

### Reliability

Delivery is non-fatal. Failures are logged, the failure count is incremented, and webhooks are automatically deactivated after 10 consecutive failures.

## API Endpoints

The API allows for programmatic interaction with Disburse features. This is particularly useful for automated systems or agents that need to issue invoices, verify payments, or fetch PSPs.

Use cases include pushing paid-state events into accounting software like QuickBooks or Xero, or updating Notion and Zapier workflows.
