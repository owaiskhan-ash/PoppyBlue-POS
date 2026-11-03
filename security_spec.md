# Security Specification - Poppy Blue POS

## 1. Data Invariants
1. **Access Authorization Invariant**: Only authenticated users with verified emails whose email is either one of the designated administrators (`ashketchupkeke@gmail.com`, `poppyblueshopify@gmail.com`, `owaiskhan722@gmail.com`) or exists in `/authorized_users/` with `active == true` may read or write any store data (invoices, stock, product_tax, customers, settings).
2. **Admin-Only Staff Management**: Only administrators may create, update, or revoke entries in the `/authorized_users` collection.
3. **Invoice Immutability & Traceability**: Invoices must have valid schema, positive totals, valid payment method ('Cash', 'UPI', 'Card'), and cannot be deleted. Corrections must preserve history and never orphan stock or billing data.
4. **Input Length and Type Guarding**: All string fields (names, phones, GSTINs, IDs) must be bounded by explicit size constraints to prevent Denial of Wallet attacks.

## 2. The "Dirty Dozen" Payloads (Must return PERMISSION_DENIED)
1. **Unauthenticated Read to Invoices**: `GET /invoices/PB-123` with no auth header.
2. **Unauthenticated Write to Stock**: `SET /stock/variant-1` with `{ qty: "99" }` without auth.
3. **Unauthorized User Read**: User `intruder@example.com` logged in via Google Auth but not in `/authorized_users` attempts `GET /invoices/PB-123`.
4. **Unauthorized User Write**: User `intruder@example.com` attempts `SET /stock/var-1`.
5. **Self-Escalation to Admin**: Cashier `cashier@example.com` attempts `SET /authorized_users/cashier@example.com` with `{ role: 'admin' }`.
6. **Malicious Giant ID**: Target single document with 10KB junk-character ID `POST /invoices/{giant-string}`.
7. **Negative Invoice Total**: User attempts `CREATE /invoices/PB-999` with `{ total: -500 }`.
8. **Invalid Payment Method**: User attempts `CREATE /invoices/PB-999` with `{ payment: 'Bitcoin' }`.
9. **Shadow Field Injection**: User attempts `CREATE /stock/var-1` with extra shadow field `{ evilBackdoor: true }`.
10. **Unverified Email Impersonation**: Attacker claims email `ashketchupkeke@gmail.com` with `email_verified == false`.
11. **Direct Document Deletion**: Authorized cashier attempts `DELETE /invoices/PB-123` (deletion of financial transaction logs is prohibited).
12. **Unauthorized Whitelist Revocation**: Cashier attempts `UPDATE /authorized_users/ashketchupkeke@gmail.com` to `{ active: false }`.
