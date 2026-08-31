# Scheduled 01:00 KST Runbook

## Purpose

Aside cron `h78L2R0UJFRhjS9O` wakes daily at 01:00 `Asia/Seoul` to research Google Trends, build at most one evidence-backed guide and publish only when every gate is green. Its standing authority is valid only with the exact `publish-on-green`/`true` policy pair and pinned routine id. Account changes, submissions outside git publication and family-record automation remain prohibited.

## Timeline

```text
01:00  read CLAUDE.md, PERSONA.md, policy, routine memory and authority-led-monetization skill/schema
01:01  fetch origin; verify gh-pages == upstream, empty index, clean render context and run ownership
01:02  start run; verify archive seals; archive only a closed prior current
01:03  run tools/capture-google-trends.mjs; preserve/hash KR RSS and normalize UTC timestamps; inventory coverage
01:07  qualify trend rows for audience fit and durable value; select zero to five research candidates
01:10  parallel official-source discovery and primary-source audit
01:25  director selects zero or one guide; no-candidate is valid
01:27  director writes/validates research/authority-brief.json; a failing authority contract blocks
01:30  director downloads 4–12 rights-clear source images + licensing sidecar; writer drafts HTML with attribution figures and makes disclosed AI cover pair
01:50  evidence editor and package validator review in parallel
02:00  bounded revision if needed, maximum two total
02:10  close ready_for_review, rejected or blocked
02:12  if green, bind standing approval digest; regenerate validation; apply and stage exactly the derived package paths
02:15  verify staged scope; commit once; push once
02:20  run tools/verify-deployment.mjs; independently verify matching Pages run, page/title/body and every exact cover/source image byte
02:30  mark published from verifier proof; notify with run id, trend decision, gates and live URL
STOP   no extra push, no account/settings/form changes, no family-record automation
```

Times are budgets, not quality deadlines. A slow source or no-candidate result may end without a draft.

## Search sequence

1. Run `node tools/capture-google-trends.mjs`; it fetches `https://trends.google.com/trending/rss?geo=KR` and atomically preserves the raw XML plus SHA-256, retrieval UTC, each source timestamp and normalized UTC value. A package signal expires after six hours. Never overwrite a prior snapshot.
2. Use Trending Now or Explore to interpret geography, time window and query grouping. Do not treat relative interest, approximate traffic or linked news as factual evidence.
3. Reject off-audience, celebrity/sports-only, accident/crime-only, partisan, advice-sensitive, speculative and duplicate query clusters.
4. For the remaining zero to five candidates, inspect current official culture, language, tourism, heritage and statistical sources plus the responsible operator.
5. Check seasonal events two to six weeks ahead and evergreen gaps in existing guides.
6. Use credible press only to locate upstream primary evidence.

Suggested authoritative entry points:

- https://www.korea.net/NewsFocus/Culture
- https://www.mcst.go.kr/english/index.jsp
- https://www.kofice.or.kr/eng/conts/view.do?mnucd=315
- https://english.visitkorea.or.kr/
- https://english.seoul.go.kr/
- https://english.visitseoul.net/
- https://www.korean.go.kr/front_eng/main.do
- https://kosis.kr/eng/
- https://english.khs.go.kr/
- https://www.hikorea.go.kr/Main.pt

Verify final landing URLs and publication dates before citing.

## Emit no draft when

- no T0/T1 source confirms anything useful;
- the topic duplicates an existing entity and intent;
- the candidate would not be useful without the trend spike;
- experience is essential but no honest owner anchor exists;
- a changing fact cannot be reverified at the operator;
- a Discover-compliant original image cannot be produced;
- fewer than four or more than twelve distinct rights-clear source-derived images can be licensed from the inspected reference materials;
- the worktree or target path conflicts with another session;
- evidence review cannot reach complete material-claim coverage;
- the authority brief cannot honestly bind the reader job, evidence-backed contribution, visible AI disclosure, related-guide next action and unmeasured plan, or the candidate is a transcript rewrite/scaled-content pattern.

Record this as a successful empty run, not a failure.

## Publish-on-green rules

- The only automatic approval reference is `standing-routine:h78L2R0UJFRhjS9O`.
- Re-read the policy before approval, before apply and before marking published. A revoked or mismatched key pair blocks the run.
- Approval removes the pre-approval report/scope. Regenerate scope first, then final validation; apply and stage only the regenerated `validation/path-scope.txt`.
- A publication is one new post, two new AI cover JPEGs and 4–12 new licensed source images, one commit and one push. `git add -A`, amend, force-push, automatic rebase and a second retry push are forbidden.
- Only `node tools/verify-deployment.mjs` may create `validation/deployment-proof.json`. It must bind its own tool hash, run id, approved artifact digest, pushed SHA, remote SHA, Pages run SHA/URL/conclusion, live URL, title/body probe, every cover and source image URL/content type/byte hash and verification UTC.
- A push with failed or missing live proof remains `[blocked]`; never report it as published or silently revert it.

## Routine memory

Carry forward only:

- last run id and status;
- selected, rejected and published topics;
- sources that were blocked, injected, stale or unreliable;
- recurring coverage gaps;
- outstanding human approval;
- archive integrity or dirty-worktree blocks;
- authority brief status, declared related-guide next action and later readout status, without invented numbers.

Never store credentials, cookies, private family data or copied article bodies in routine memory.

## Notification

Report:

- run id and status;
- selected topic or no-draft reason;
- why now and primary source count;
- experience mode and authority brief status;
- related-guide next action and publish-time `not-measured` readout state;
- gate results;
- draft and review paths when present;
- `NOT PUBLISHED` until live proof, then `PUBLISHED` plus the verified live URL;
- for a green publication: approval digest, commit SHA, matching Pages run URL, permalink status and every cover/source image status.
