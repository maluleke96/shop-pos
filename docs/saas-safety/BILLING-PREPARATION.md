# Billing preparation (no payment gateways yet)

Manual subscription status on `platform_shops` is the **source of truth**:

- `TRIAL` | `ACTIVE` | `OVERDUE` | `SUSPENDED`

Package/add-on assignment drives entitlements via the Phase 4 engine.  
Billing providers must **not** recalculate entitlements — they only suggest status changes.

## Future provider adapters (stubs)

Connect later without redesigning packages:

| Provider | Adapter hook (future) | Maps to |
|----------|----------------------|---------|
| PayFast | `billing/providers/payfast.js` | webhook → `setSubscriptionStatus` |
| Paystack | `billing/providers/paystack.js` | webhook → `setSubscriptionStatus` |
| Stripe | `billing/providers/stripe.js` | webhook → `setSubscriptionStatus` |

### Contract

1. Verify webhook signature (provider secret in **server env only**).  
2. Resolve `shop_id` from metadata (never from client-supplied package lists alone).  
3. Call existing `platform-shops.setSubscriptionStatus(shopId, status)`.  
4. Queue `syncCustomerEntitlements(shopId)` so customer env + DB assignment update.  
5. Never delete business data on `OVERDUE` / `SUSPENDED`.

### Do not

- Put Railway tokens in billing webhooks  
- Let a payment provider rewrite `platform_package_items`  
- Enforce SaaS billing on Chisa Food  

## Current operator workflow

Platform → Shops → set status manually → Sync entitlements if the shop is provisioned.
