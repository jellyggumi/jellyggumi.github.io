# 2026 Influence, Google Ads and Culture-Journal Strategy

This reference turns research findings into operating rules. Recheck linked policies before relying on them because platform guidance changes.

## Positioning

JellyGGumi is not a general Korea-content mill. Its defensible position is:

> Everyday Korea, explained by a parent living here, with primary-source checks and a visible distinction between observation, explanation and sourced fact.

The guide desk exists to build trust and recognition around that position. Search, Discover, social adaptation and advertising are distribution surfaces, not the editorial purpose.

## Trust rules

Influencer research consistently makes transparency, honesty and negative or inconvenient detail central to credibility. Operational consequences:

- Keep the human site owner responsible; do not assign an AI byline.
- Disclose AI-assisted production and AI-generated imagery where a reader could reasonably wonder how it was made.
- Include one limitation, variation or inconvenient finding instead of pure promotion.
- Do not hide material relationships. Automated runs prohibit sponsorship, gifted-product endorsement, affiliate links and campaign tracking.
- If a future human-authored endorsement has a material connection, disclose it beside the endorsement, not only in a footer or hashtag bundle.

References:

- FTC, Disclosures 101 for Social Media Influencers: https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers
- BBB National Programs, Influencer Trust Index: https://bbbprograms.org/programs/advertising/influencer-trust-index
- Korea Fair Trade Commission press materials: https://www.ftc.go.kr/

## Helpful-content and scaled-content rules

Google asks whether content provides original reporting, research or analysis and warns against mass creation without added value, including generative-AI scaling and automated translation. Operational consequences:

- Zero articles is a valid daily result.
- No machine translation, synonymisation, stitched source summaries or one page per query variant.
- Require direct primary evidence, a distinct thesis and a non-obvious finding.
- Do not change dates merely to appear fresh.
- Do not create a topic solely because it is trending.
- A deliberate producer-reviewer curation gate remains mandatory before publication and ad serving; a trend signal never bypasses it.

References:

- Google Search spam policies, scaled content and doorway abuse: https://developers.google.com/search/docs/essentials/spam-policies
- Google, creating helpful, reliable, people-first content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google Publisher Policies, inventory value: https://support.google.com/publisherpolicies/answer/11112688

## Discover and image rules

Discover recommends large, compelling, non-generic and non-text-heavy images, at least 1200 pixels wide, with large-image previews enabled. Operational consequences:

- 1672×941 hero as a real `<img>`.
- 700×394 card thumbnail.
- Preserve `max-image-preview:large`, `og:image` and structured image metadata.
- Avoid logos, text-heavy compositions, sensational visual framing and clickbait.
- Record image provenance and visibly label AI-generated still lifes.

Reference: https://developers.google.com/search/docs/appearance/google-discover

## Google Trends qualification

Use the official Korea Trending Now RSS feed for lightweight daily intake, then verify promising terms in Trending Now or Explore. The feed has no published API SLA, and the general Trends API remains limited alpha access, so fail closed when official data is unavailable rather than substituting an unofficial scraper.

- Treat search interest as sampled, anonymized, categorized, aggregated and normalized relative interest, not absolute volume or a public-opinion poll.
- Store raw-feed SHA-256, retrieval UTC, source timestamp and normalized UTC timestamp.
- Use the past-24-hours window for intake and past-7-days context only when needed; the stored publishable signal expires after six hours.
- Reject low-volume noise, broad query ambiguity and clusters outside the journal's audience.
- Publish only if the guide remains useful without the spike and primary sources independently support every material fact.

References:

- Trending Now controls and RSS export: https://support.google.com/trends/answer/3076011?hl=en
- Trends data FAQ: https://support.google.com/trends/answer/4365533?hl=en
- Search use cases for Trends: https://developers.google.com/search/docs/monitor-debug/trends-start
- Trends API alpha status: https://developers.google.com/search/apis/trends

## 2026 Google Ads direction

Google Ads is consolidating visual discovery demand across surfaces through Demand Gen. JellyGGumi should treat the editorial hero as a reusable creative source, not make ad-shaped pages.

- Compose the hero so a later human campaign can crop it to landscape, square and portrait without losing the subject.
- Keep the article canonical. Any later ad or social adaptation links back to it and does not change its claim scope.
- Do not create a Demand Gen campaign, spend budget or connect accounts from the editorial routine.
- Do not use ad performance as proof that a cultural claim is true.

Reference: Google Ads Help, Demand Gen upgrades and migration guidance: https://support.google.com/google-ads/answer/15973205

## Korean-culture demand

International interest in Korean culture spans cultural content and everyday practices. A durable journal should move beyond celebrity or release coverage and explain mechanisms readers can use: signs, etiquette, operator rules, seasonal practices and family routines. Use KOFICE surveys and KOSIS tables for scoped trends, with dataset date and population stated.

References:

- KOFICE research: https://www.kofice.or.kr/eng/conts/view.do?mnucd=315
- KOSIS English: https://kosis.kr/eng/

## Candidate scorecard

Score each candidate 0–2 on:

1. audience fit;
2. primary-source strength;
3. distinct thesis;
4. honest experience fit;
5. practical usefulness;
6. non-commodity finding;
7. original image opportunity;
8. freshness without fake urgency.

A high score does not override a hard gate. No primary source, duplicate intent, fabricated experience or unusable art means reject.

## Distribution boundary

The daily routine creates at most one canonical English guide and may publish it only through the pinned repository publish-on-green path. LinkedIn, X, YouTube, Instagram, Naver, Google Ads and email remain separate, confirmation-gated adaptations. Do not auto-post, buy ads, open campaigns or add newsletter capture from this harness.
