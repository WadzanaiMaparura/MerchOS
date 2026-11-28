# Operations to-do

Things to do on the platform that are not code features. Newest decisions at the top of each section. Tick an item off by moving it to "Done" with the date.

## Soon (dated)

- [ ] **On or after 5 December 2026: delete the old merchos.co.za hosted zone in the dev account** (`Z04418812LQLSF1AUT0WU`, account 388096320605).
  - Why: merchos.co.za moved to the production account on 28 November 2026, and the zone now in use is `Z09653993RPEWGMMIA4M9` (account 368138021859). The old zone was kept as a mirror while resolvers moved over. It costs about $0.50 a month.
  - Before deleting:
    1. Check the `.co.za` registry lists only the new name servers: `nslookup -type=NS -norecurse merchos.co.za coza1.dnsnode.net` should show ns-1804, ns-497, ns-953 and ns-1415.
    2. Check nothing changed in the production zone since the cutover that was not mirrored (website, `api`, DKIM, mail records).
  - Delete: remove every record except NS/SOA, then the zone. Do not touch `dev.merchos.co.za` (`Z069209129NS1A703O5O7`): it is a separate zone that dev uses.

## Long term

- [ ] **Move the merchos.co.za registration into the company account (368138021859).**
  - It is still registered in the founder's personal AWS account, so renewal is billed there. Expires 1 July 2027 with auto-renew on, so keep a valid card on that account until this is done.
  - Blocked so far: Route 53 says "not transferable at this time". The domain had transfer lock on (`clientTransferProhibited`).
  - Steps: personal account > Route 53 > Registered domains > merchos.co.za > turn off transfer lock (wait for the request to succeed) > Transfer out > Transfer to another AWS account > 368138021859. Then accept in the production account (Route 53 > Requests) with the transfer password, and turn the lock back on there. Free, and the expiry date is unchanged. If it is still refused, open a case with AWS Support (domain registration help is free on Basic support).

- [ ] **GitHub deploys with approval (OIDC).** CI (`.github/workflows/ci.yml`) builds and tests but does not deploy; all deploys are run by hand.

## Going live (the last button)

PayFast is switched on last. Until then production takes no payments: `checkoutEnabled`, `cardSubscriptions` and `referralFreeMonths` are "false" in `infrastructure/cdk.json` (envConfig.production), and the `NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED` / `NEXT_PUBLIC_CARD_SUBSCRIPTIONS` variables are not set on the production Amplify apps.

- [ ] Put the live PayFast values into the production secret `merch-os/production/payfast` (it holds a placeholder).
- [ ] In PayFast, set the notify URL to `https://api.merchos.co.za/billing/payfast/itn` (now served by production).
- [ ] Fix the merchant display name ("NECHA").
- [ ] R5 live test with `checkoutEnabled` / `cardSubscriptions` temporarily true; then the change-amount test, a renewal, a cancel, and the referral free month (PayFast `run_date`).
- [ ] Open sign-ups (`signupsOpen`, and `NEXT_PUBLIC_SIGNUPS_OPEN=true` on the production seller app) when ready.

## Done

- 28 Nov 2026: merchos.co.za, admin, www and api moved to the production account; dev moved to dev.merchos.co.za / admin.dev.merchos.co.za / api.dev.merchos.co.za.
- 28 Nov 2026: dev sites password-locked (Amplify basic auth on both dev apps). The username and password are in Secrets Manager, dev account: `merch-os/dev/site-password`. To change the password: update that secret, then run `aws amplify update-branch --enable-basic-auth --basic-auth-credentials <base64 user:password>` on both dev apps (d1jwaah0zt7pg5, d3katl1796jtte).
- 28 Nov 2026: Nova Pro (the fallback model) confirmed working in production.
