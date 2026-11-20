# Work — read a job posting and extract what the candidate's criteria need

You are the reader of one job posting. You do not decide whether the offer is kept: a
deterministic rule does that from what you extract. Your job is to extract, faithfully and
with proof, the facts the candidate's criteria depend on, and to write them to
`$ARTIFACTS_DIR/$INPUTS.out` as JSON. You run inside a loop: a script checks your file after
every turn (every quote must be in the posting word for word; the script also scans the
posting for languages, amounts and years of experience you may have missed). Fix what it reports.

## The offer (radar fields)

$INPUTS.offer

## The candidate's criteria (criteres.json)

$INPUTS.criteria

`langues` are the languages the candidate speaks (ISO 639-1). `salaire_min_annuel` is the
minimum gross yearly pay in euros. `remote` is the work mode the candidate accepts (`full`,
the default: fully remote only; `hybride_ok`; `indifferent`), decided by the rule from your
`work_mode`. `experience_max_annees`, when present, is the most years of experience a posting
may ask of the candidate (the rule reads your `experience`; the title words of
`experience_labels_exclus`, "senior", "lead", "head of"… by default, are checked by the code
on the offer's title). `zone_embauche`, when it is `europe`, means the candidate lives in
Europe (United Kingdom and Ireland included): the rule reads your `hiring_zone`. `exclure`,
when present, lists free criteria.

## The posting

Read `$ARTIFACTS_DIR/$INPUTS.posting` completely. It is the posting text the caller fetched,
followed by the radar's own fields. Page chrome (menus, "sign in", similar jobs, cookie
banners) is not part of the posting: never extract a requirement or an amount from it.

## The candidate's profile

Profile file name: `$INPUTS.profile`

When this name is empty, there is no profile: write `"core_requirements": []` and skip rule 10.
Otherwise read `$ARTIFACTS_DIR/$INPUTS.profile` completely: it is the candidate's master
profile (experience, skills, tools, results). It is the only evidence of what the candidate
has done; never assume a skill it does not state.

## Problems the check reported on the previous turn

$INPUTS.problems

Empty means this is the first turn. Otherwise read your current file, fix every problem,
keep what was right.

## What to write

`$ARTIFACTS_DIR/$INPUTS.out`, one JSON object:

```json
{
  "languages": [
    { "code": "it", "requirement": "required", "quote": "Fluent in English and Italian" }
  ],
  "not_required": [
    { "code": "it", "quote": "our clients across the Italian market", "why": "names a market, not a language asked of the candidate" }
  ],
  "salary": { "min": 38000, "max": 45000, "currency": "EUR", "period": "year", "quote": "between 38.000€ and 45.000€" },
  "salary_ignored": [
    { "quote": "raised $20M", "why": "funding round, not pay" }
  ],
  "other_criteria": [
    { "criterion": "exclure: call center", "met": false, "quote": "You will handle inbound calls in our contact center", "note": "centre d'appels" }
  ],
  "posting_language": { "code": "en", "quote": "You will own our go-to-market processes across Sales and Customer Success." },
  "work_mode": { "value": "hybrid", "quote": "3 days a week in our Lisbon office, the rest from home" },
  "experience": {
    "years_min": 7, "years_max": null, "seniority_label": "senior",
    "quote": "Profil senior. Minimum 7 ans d'expérience en Product Marketing",
    "ignored": [ { "quote": "Nous avons 10 ans d'expérience du marché", "why": "the company speaks of itself, not a requirement" } ]
  },
  "hiring_zone": { "value": "open", "quote": "This role is fully remote: work from anywhere in Europe." },
  "core_requirements": [
    { "requirement": "Achat média payant à gros volume (Meta, TikTok, Snapchat)", "quote": "2-7 years of hands-on experience running high-volume paid acquisition on Meta, TikTok and Snapchat", "backing": "missing", "profile_quote": "" },
    { "requirement": "SQL et Python pour l'analyse", "quote": "Strong SQL and Python skills", "backing": "partial", "profile_quote": "Requêtes SQL simples pour le suivi des campagnes" },
    { "requirement": "Pilotage de lifecycle CRM", "quote": "You will own our lifecycle and CRM programs", "backing": "backed", "profile_quote": "Refonte du parcours CRM (emails, push) pour 120 000 clients" }
  ],
  "tools_requested": [
    { "tool": "Klaviyo", "quote": "Hands-on Klaviyo experience (flows, segmentation)" }
  ],
  "summary": "One sentence, in French, for the candidate."
}
```

Rules:

1. `languages`: every language the posting asks of the candidate, English and French
   included. `required` when the posting makes it a condition (fluent, native, C1, "must",
   "is required", a posting written for native speakers of a market, "X-speaking" in the
   title); `preferred` only when the posting itself softens it ("is a plus", "nice to have",
   "an advantage", "ideally"). When in doubt, `required`: the judge will check.
2. `not_required`: each language the posting names near words like fluent, speaking, level
   or language that is NOT asked of the candidate (a market, a country, a team, a product
   locale), with the quote and why. Every language the posting names in such a context must
   appear in `languages` or `not_required`.
3. `quote`: copy the exact words from the posting file (a sentence or a clause, at most 400
   characters), and the quote of a language must contain that language's name.
4. `salary`: the pay for this role as the posting states it, amounts exactly as written
   (no conversion: 3 200 per month stays `3200` with `period: "month"`; "38-45k" gives 38000
   and 45000), `currency` as ISO 4217, `period` one of year, month, week, day, hour. `min` or
   `max` may be null ("up to 40k" has only max; "from 30k" only min). `null` when the posting
   gives no pay. Radar fields marked as an estimate are not the posting's pay.
5. `salary_ignored`: every other amount with a currency in the posting (funding, revenue,
   budgets, bonuses you did not count as base pay), with why. When `salary` is null, each
   amount with a currency must be listed here.
6. `other_criteria`: one entry per free criterion of `criteres.json` (each `exclure`),
   `met` true/false with a quote, or null with an empty quote when the posting says nothing
   about it. Empty array when there is no free criterion. `remote` is not a free criterion:
   it goes in `work_mode`.
7. `posting_language`: the language the job description itself is written in (ISO 639-1),
   not the language of the site's menus, with a quote of one full sentence of the description
   (60 characters or more). A posting in another language than the candidate's is rejected
   by the rule, so read the description, not the page chrome. For a bilingual posting, give
   the language of the main description.
8. `work_mode`: where the work happens, with the verbatim sentence that states it:
   - `full_remote` — the posting says the role is fully remote ("100% remote", "fully
     remote", "remote-first", "work from anywhere", "télétravail total"). "Remote-friendly"
     or "remote possible" alone is not full remote.
   - `hybrid` — some days on site ("hybrid", "3 days a week in our office", "2 jours de
     télétravail par semaine"), including office presence for a period only ("for the first
     few months, new hires spend most days at the Milan office", in-person onboarding): that
     is `hybrid` (or `on_site`) even when the role is remote afterwards.
   - `on_site` — the role is at a workplace ("on-site", "présentiel", "based in our Athens
     office", "relocation to Berlin", a location given as the place of work with no remote
     mention when the posting describes office life).
   - `not_stated` — the posting says nothing about it; `quote` is then empty. A city in the
     radar fields or a job title is not a statement of the work mode: when the posting only
     names a location, write `not_stated` (the rule leaves the offer "à vérifier", never
     "retenue"). The script scans the posting for these words: a "hybrid" or "on-site"
     phrase you did not account for sends you back.
9. `experience`: the experience the posting asks of the candidate, with the verbatim
   sentence that asks for it:
   - `years_min` / `years_max`: integers as the posting states them ("7 ans d'expérience"
     gives 7 and null; "3 à 5 ans" gives 3 and 5; "5+ years" gives 5 and null; "jusqu'à 2 ans"
     gives null and 2), or null. The rule reads the lower bound against `experience_max_annees`.
   - `seniority_label`: the word of the posting that names the level ("senior", "lead",
     "confirmé", "junior"…) when the posting states one, or null. "Reporting to a senior
     manager" is not a label of this role: leave null.
   - `quote`: the words of the posting that carry the numbers and the label (at most 400
     characters; both must appear in it). All three null and an empty quote (or the string
     `"not_stated"`) when the posting asks for no experience: the rule then has no effect.
   - `ignored` (optional): the years the posting mentions that are not asked of the
     candidate ("nous avons 10 ans d'expérience du marché", "7 ans d'existence"), with the
     quote and why. The script scans the posting for years of experience ("7 ans
     d'expérience", "minimum 5 years", "5+ years in", "3 à 5 ans"): one you did not account for
     in `quote` or `ignored` sends you back.
10. `core_requirements` (only when a profile is given): exactly 3 entries, the requirements
    without which the role cannot be done (the main hands-on skill, channel, tool or domain
    the posting is built around, as in "What you'll do" / "What we're looking for"), most
    central first. Not a language, the pay, the work mode or a soft skill ("team player"):
    those are handled elsewhere. Not a named tool or software either (Klaviyo, Shopify,
    HubSpot, Salesforce, Figma, Google Ads as a product, a CRM or CMS by name): the candidate
    judges tools himself, so a tool never counts for or against the offer. When the posting
    asks for "Klaviyo flows", the requirement is the skill behind it ("automatisation
    lifecycle e-mail, parcours conditionnels"), and the profile backs it with whatever tool it
    names (Brevo, Mailchimp, HubSpot back e-mail automation just as Klaviyo would). Put the
    tool itself in `tools_requested` (rule 12). For each:
    - `requirement`: a few words, in French, naming it (at most 120 characters).
    - `quote`: the verbatim words of the posting that ask for it (job description only, not the
      radar fields; at most 400 characters); three distinct quotes.
    - `backing`: what the profile shows. `backed`: the profile states this skill or experience
      at the level asked. `partial`: the profile shows something close but lighter (another
      channel, smaller scale, a side project, fewer years). `missing`: the profile shows
      nothing of it. Be strict: a related word is not a backing ("social media" does not back
      "high-volume paid buying on TikTok"; "Excel" does not back "SQL and Python").
    - `profile_quote`: for `backed` and `partial`, the verbatim words of the profile file that
      show it (at most 400 characters, Markdown marks like `**` may be dropped); empty for
      `missing`. The script checks every quote against the posting and the profile.
    The rule, not you, decides: two `missing` reject the offer; one gives a note "À renforcer".
11. `hiring_zone` (required when `zone_embauche` is `europe`): where the role can be filled
    from, with the verbatim sentence that says it:
    - `open` — the posting hires in Europe, a European country (UK and Ireland included), EMEA,
      or anywhere ("work from anywhere in Europe", "remote within EMEA", "we hire worldwide").
    - `closed` — the posting keeps the role to candidates outside Europe ("US only", "must
      reside in the United States", "authorized to work in the US", "Canada-based", "LATAM",
      "APAC time zones", "US payroll only"), or names only non-European countries as the
      places it hires from.
    - `not_stated` — the posting says nothing about it; `quote` is empty. The employer's
      headquarters or a city in the radar fields is not a statement of where it hires.
    The rule, not you, decides: `closed` rejects the offer; `not_stated` is a note.
12. `tools_requested`: every tool or software the posting names as a requirement or a plus
    (Klaviyo, Shopify, HubSpot, Salesforce, Figma, Webflow, Looker…), each with its verbatim
    quote from the job description; `[]` when it names none. Listed for the candidate, who
    judges them; they never reject the offer and never appear as a core requirement.
13. Do not modify anything else; write only `$ARTIFACTS_DIR/$INPUTS.out`.

## Declare

Return exactly:

- `summary` — one or two sentences: the role, and what you found on languages, pay, experience and the core of the role.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
