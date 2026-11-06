# 09: Full run, deployment, the owner's re-authorization, live check

**What to build:** plan T8. Full checks once (vitest, the Yekaterinburg run, the stand, tsc, build). Code.gs
first (owner's `clasp push` + `clasp deploy -i …`, clone + cmp), then Cloud Run from a clean export with the
served-chunk comparison. Right after the Code.gs deploy the owner re-authorizes the script for Drive (step by
step instructions), then installs the light-poll triggers. Live check on the first invoice from week 43 on:
handovers detected with the right days, goods written off automatically, the invoice read, step 1 and step 2
applied, KAN figures equal to «История». Record in plan, DEVLOG, TEST_LOG.

**Blocked by:** 01–08.

**Status:** wontfix — cancelled by the owner 2026-11-06 (item 97 rolled back)

- [ ] Re-authorization done before any trigger fires on the new code
- [ ] Trigger runtime per day measured after one day live

## Comments
