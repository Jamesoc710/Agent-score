# AgentRank - the cohort (28 sites)

Readable companion to `data/cohort.csv` (canonical). Scoring/matching logic and cohort design rationale are in [METHODOLOGY.md](./METHODOLOGY.md). Every `answer_substring` was pre-registered by hand during the manual cohort pass, before any agent run.

The **URL** field on each entry is the answer page (where the fact lives, used for the manual pass and extraction baselines); the agent starts from `start_url` in the CSV. Domino's and NYT were dropped during the pass (gated/promo pricing). URLs marked `[confirm ...]` need the exact product/event page used in the pass.


## Top anchors (modern SaaS / dev tools)

### 1. Stripe (`stripe`)
- **URL:** https://stripe.com/pricing
- **Question:** What is Stripe's standard rate for online domestic card payments?
- **answer_substring:** `2.9%`
- **match rule:** exact; case/space-normalize
- **answer_note:** Standard online card processing rate, 2.9% + 30 cents per transaction, from the pricing page.

### 2. Shopify (`shopify`)
- **URL:** https://www.shopify.com/pricing
- **Question:** What is the monthly price of Shopify's Basic plan?
- **answer_substring:** `$29`
- **match rule:** strip $; numeric word-boundary
- **answer_note:** Monthly price of the entry-level Basic plan. Confirm the annual-vs-monthly figure shown by default.

### 3. GitHub (`github`)
- **URL:** https://github.com/pricing
- **Question:** What is the per-user monthly price of GitHub's Enterprise plan?
- **answer_substring:** `$21`
- **match rule:** strip $; numeric word-boundary
- **answer_note:** Per-user monthly price of the Enterprise plan. Confirm it is displayed (not contact-sales); note billing cycle.

### 4. Twilio (`twilio`)
- **URL:** https://www.twilio.com/en-us/sms/pricing/us
- **Question:** What does it cost to send one SMS to a US number on Twilio?
- **answer_substring:** `0.0083`
- **match rule:** strip $; match decimal
- **answer_note:** Per-message US SMS price. Outbound and inbound SMS are both $0.0083; MMS differs, so SMS is distinguishable. May require selecting United States.

### 5. Notion (`notion`)
- **URL:** https://www.notion.com/pricing
- **Question:** What is the monthly per-user price of Notion's Plus plan?
- **answer_substring:** `$12`
- **match rule:** strip $; numeric word-boundary
- **answer_note:** Monthly per-user price of the Plus plan. Confirm billing cycle; check no '$12x' annual total appears elsewhere on the page.

### 6. Cloudflare (`cloudflare`)
- **URL:** https://www.cloudflare.com/plans/
- **Question:** What is the monthly price of Cloudflare's Pro plan?
- **answer_substring:** `$20 | $25`
- **match rule:** any-of; strip $; numeric word-boundary ($20 != $200)
- **answer_note:** Monthly price of the Pro plan; two valid values ($20 annual, $25 monthly). Business plan ($200/mo) is on the same page, so word-boundary match so '$20' does not match '$200'.


## Mainstream middle (retail / media / membership)

### 7. Best Buy (`bestbuy`)
- **URL:** [identified 2026-08-09: model 90YA003GUS, SKU 12293931, now $1,999.00 via marketplace seller PC Heaven — awaiting URL paste + amendment approval]
- **Question:** What is the price of the Lenovo Legion Tower 5i (Core Ultra 7 265F, 32GB, RTX 5060Ti, 1TB, Eclipse Black)?
- **answer_substring:** `1848`
- **match rule:** strip $, commas, trailing .00
- **answer_note:** Lenovo Legion Tower 5i gaming desktop, $1,848.00, standard price (not discounted).

### 8. IKEA (`ikea`)
- **URL:** https://www.ikea.com/us/en/p/kivik-sectional-4-seat-with-chaise-grann-bomstad-black-s99443193/ (pinned 2026-08-09; $2,099.00 verified, not discounted)
- **Question:** What is the price of the KIVIK 4-seat sectional with chaise (Grann/Bomstad black)?
- **answer_substring:** `2099`
- **match rule:** strip $, commas, trailing .00
- **flag:** consent-wall obstacle
- **answer_note:** KIVIK 4-seat sectional with chaise (Grann/Bomstad black), $2,099.00 USD, not discounted. Cookie-consent wall is a navigation obstacle for the agent.

### 9. Target (`target`)
- **URL:** https://www.target.com/p/clorox-toiletwand-disposable-toilet-cleaning-system-toiletwand-storage-caddy-and-6-refill-heads/-/A-13025048
- **Question:** What is the price of the Clorox ToiletWand cleaning system (caddy + 6 refill pads)?
- **answer_substring:** `12.89`
- **match rule:** strip $; keep decimal
- **answer_note:** Clorox ToiletWand cleaning system (caddy + 6 refill pads), $12.89. Odd-cents price is unique to this product.

### 10. Spotify (`spotify`)
- **URL:** https://www.spotify.com/us/premium/
- **Question:** What is the recurring monthly price of Spotify Premium Individual?
- **answer_substring:** `12.99`
- **match rule:** strip $; keep decimal
- **answer_note:** Recurring monthly price of Premium Individual, $12.99. The '$0 for 3 months' shown above it is a temporary new-user promo, not the standing price.

### 11. Costco (`costco`)
- **URL:** https://www.costco.com/join-costco.html
- **Question:** What is the annual fee for Costco's Gold Star membership?
- **answer_substring:** `$65`
- **match rule:** strip $; numeric word-boundary ($65 != $650)
- **answer_note:** Annual Gold Star (base) membership fee, $65. Executive tier ($130) is on the same page.


## Government and education (seeded bottom)

### 12. California DMV (`ca_dmv`)
- **URL:** https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/real-id/
- **Question:** By what time must written tests be completed at California DMV offices?
- **answer_substring:** `4:30`
- **match rule:** exact
- **answer_note:** REAL ID page. Written tests are unavailable at DMV offices after 4:30 p.m. (buried in step 3). Distinctive token.

### 13. Texas DMV (`tx_dmv`)
- **URL:** https://www.txdmv.gov/motorists/register-your-vehicle
- **Question:** How early before expiration can you renew your Texas vehicle registration online?
- **answer_substring:** `90 days`
- **match rule:** exact phrase; case/space-normalize
- **answer_note:** Vehicle registration renewal. You can renew online up to 90 days before expiration (and up to 12 months after, absent a citation). Avoid the Texas-by-Texas usage stats (they change).

### 14. USPS (`usps`)
- **URL:** https://www.usps.com/ship/first-class-mail.htm
- **Question:** What is the current price of a First-Class Forever stamp (1 oz)?
- **answer_substring:** `0.78 | 78 cents`
- **match rule:** any-of; strip $; keep decimal
- **answer_note:** Current First-Class Forever stamp price (1 oz), $0.78. Other prices on the page ($0.61, $1.27, $1.63) differ, so $0.78 discriminates.

### 15. IRS (`irs`)
- **URL:** https://www.irs.gov/credits-and-deductions-for-individuals
- **Question:** What is the 2025 standard deduction for a single filer?
- **answer_substring:** `15750`
- **match rule:** strip $, commas
- **answer_note:** 2025 standard deduction for a single filer, $15,750. Discriminates from MFJ ($31,500) and head of household ($23,625); single and MFS share $15,750.

### 16. Social Security Admin (`ssa`)
- **URL:** https://www.ssa.gov/benefits/retirement/planner/agereduction.html
- **Question:** What is the full retirement age for someone born in 1960 or later?
- **answer_substring:** `67`
- **match rule:** exact; avoid table-dump
- **answer_note:** Full retirement age for someone born in 1960 or later, 67. Number-dense page; '67' also sits inside '26.67%' (1955 row), only a risk if the agent reproduces the whole reduction table.

### 17. TriMet (`trimet`)
- **URL:** https://support.trimet.org/hc/en-us/articles/4417251761051
- **Question:** How much is an adult Day Pass on TriMet?
- **answer_substring:** `5.60`
- **match rule:** strip $; keep decimal
- **answer_note:** Adult Day Pass, $5.60 (the one unique value on the page). The 2.5-hour adult fare ($2.80) is shared with the Honored Citizen and Youth Day Passes, so it was avoided.

### 18. City of Portland (`portland`)
- **URL:** https://www.portland.gov/ppd/commercial-permitting/food-carts
- **Question:** On what online platform do you submit your application and pay fees for a Portland food cart permit?
- **answer_substring:** `DevHub`
- **match rule:** case-normalize (proper noun)
- **answer_note:** Food cart permits. Applications are submitted and fees paid on DevHub. The fee itself is gated behind DevHub, so a distinctive proper noun is used instead.

### 19. Oregon State University (`oregon_state`)
- **URL:** https://financialaid.oregonstate.edu/cost-attendance
- **Question:** What is the 2025-26 resident (in-state) undergraduate tuition and fees for the full year at OSU?
- **answer_substring:** `15246`
- **match rule:** strip $, commas
- **flag:** interaction-test (accordion)
- **answer_note:** 2025-26 resident (in-state) undergraduate tuition and fees, $15,246. Non-resident ($40,392) discriminates. On the cost-attendance page the figure sits behind an expandable section (interaction test).


## Small business / one-pagers

### 20. Powell's Books (`powells`)
- **URL:** https://www.powells.com/book/practices-in-apparition-9781945649608?condition=New (pinned 2026-08-09; $22.95 Trade Paperback, New, verified)
- **Question:** What is the Trade Paperback price of 'Practices in Apparition' by Gabi Abrao on Powell's?
- **answer_substring:** `22.95`
- **match rule:** strip $; keep decimal
- **answer_note:** 'Practices in Apparition' by Gabi Abrao, Trade Paperback, $22.95. Maps to the paperback format. Minor residual risk: book prices cluster at .95 endings, but the named title pins it.

### 21. Voodoo Doughnut (`voodoo`)
- **URL:** https://www.voodoodoughnut.com/locations/
- **Question:** What is the ZIP code of the Old Town Portland Voodoo Doughnut location?
- **answer_substring:** `97204 | 5032414704`
- **match rule:** any-of; exact; phone alt digits-only
- **answer_note:** Old Town Portland location (22 SW 3rd Ave) ZIP code, 97204. Prices are gated behind the order flow, so a location fact is used. Alternative: phone, digit-normalized to 5032414704.

### 22. In-N-Out (`innout`)
- **URL:** https://www.in-n-out.com/history
- **Question:** In what year was In-N-Out founded?
- **answer_substring:** `1948`
- **match rule:** exact
- **answer_note:** Founding year, 1948 (first store, Baldwin Park), from the history timeline. The timeline has other years, but the question targets the founding year.

### 23. Bear (`bear`)
- **URL:** https://bear.app/
- **Question:** What does Bear Pro cost?
- **answer_substring:** `2.99 | 29.99`
- **match rule:** any-of; strip $; keep decimals
- **answer_note:** Bear Pro subscription; two valid prices shown together, $2.99/month and $29.99/year (any-of). The two values do not collide with each other.


## Off-diagonal bets

### 24. Apple (`apple`)
- **URL:** https://www.apple.com/iphone-17-pro/
- **Question:** What is the starting price of the iPhone 17 Pro?
- **answer_substring:** `1099 | 45.79`
- **match rule:** any-of; strip $, commas; keep decimals
- **flag:** off-diagonal: high static / low behavioral
- **answer_note:** iPhone 17 Pro starting price, from $1099 (or $45.79/mo financing); any-of accepts either. Discriminates from other iPhone models. Heavy SPA may lower behavioral success despite high Lighthouse - surprising-result candidate.

### 25. Craigslist (`craigslist`)
- **URL:** https://www.craigslist.org/about/help/posting_fees
- **Question:** What does it cost to post a job in the job categories on Craigslist (US)?
- **answer_substring:** `75 | Visa | MasterCard | American Express`
- **match rule:** any-of; strip $
- **flag:** off-diagonal: low static / high behavioral
- **answer_note:** Job-posting fee (US) is $10-75; '75' is the unique distinctive token on the page. Most other fees are $5 (shared), avoided. Plain old HTML, expected low Lighthouse but high behavioral success - mirror of Apple.

### 26. Zalando (`zalando`)
- **URL:** https://www.zalando.pt/adidas-originals-calcas-multicolor-bronze-strata-ad121a1k5-o11.html (pinned 2026-08-09, bronze strata colorway; page shows 62,95 sale from 69,95 original, and a carbon colorway of the same name shows 59,45 — amendment decision pending. Site browses fine from US; only shipping is restricted)
- **Question:** What is the price of the adidas Originals Wide Leg Leo Print Satin Pants on Zalando (Portugal)?
- **answer_substring:** `69,95 | 69.95`
- **match rule:** any-of; strip euro symbol; DO NOT comma-strip (comma is the decimal)
- **flag:** off-diagonal: high static / low behavioral; language confound
- **answer_note:** adidas Originals satin pants on Zalando Portugal (zalando.pt), 69,95 euros (VAT incl.). Comma is a DECIMAL, not a thousands separator, so do NOT comma-strip this row; any-of catches '69,95' and '69.95'. Pin the .pt product URL. Confirm not discounted. Portuguese-language page is a confound to note when interpreting its result.


## Intentional blockers (anti-bot)

### 27. Amazon (`amazon`)
- **URL:** https://www.amazon.com/NEW-JETO-Frame-Simple-Atmospheric-Platform/dp/B0B8VQLN6Y (pinned 2026-08-09, Queen 14-inch variant; price found $59.99 that day — answer-key amendment from 53.99 pending approval)
- **Question:** What is the price of the NEW JETO metal bed frame in Queen size (14 inch)?
- **answer_substring:** `53.99`
- **match rule:** strip $; keep decimal
- **flag:** intentional blocker (expect blocked)
- **answer_note:** NEW JETO metal bed frame, Queen 14-inch, $53.99. Size variants (Twin $39.99, Full $52.99, King $56.99) discriminate; ignore the $43.99 store-card promo. INTENTIONAL BLOCKER: expect failure_mode 'blocked', near-zero success is the finding. Price is volatile but moot if blocked.

### 28. Ticketmaster (`ticketmaster`)
- **URL:** https://www.ticketmaster.com/zach-bryan-w-gregory-alan-isakov-auburn-university-10-10-2026/event/Z7r9jZ1A7r4ev (pinned 2026-08-09; Gregory Alan Isakov confirmed as opener)
- **Question:** Who is the opening act for Zach Bryan on October 10, 2026?
- **answer_substring:** `Gregory Alan Isakov | Hare Stadium`
- **match rule:** any-of; case-normalize (proper noun)
- **flag:** intentional blocker (expect blocked)
- **answer_note:** Zach Bryan event (Oct 10, 2026, Jordan-Hare Stadium, Auburn, AL). Stable fact used: opener Gregory Alan Isakov. Do NOT use the $89.44 resale price (transient single listing). INTENTIONAL BLOCKER: expect failure_mode 'blocked'.
