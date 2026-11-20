# Judge — is this extraction faithful to the posting?

You are the judge of one job triage. You did not see the extraction being made. A script
already proved the mechanical facts: every quote is in the posting word for word, every
language named near a requirement word, every amount with a currency and (when the criteria
cap the years of experience) every "N years of experience" phrase is accounted for, every
core-requirement quote is in the posting and every profile quote in the candidate's profile
(word for word), any office presence asked for a period (onboarding, first months) was read
as hybrid or on site, and it
computed the decision from the extraction with a fixed rule. What code cannot decide
is whether the extraction reads the posting correctly. That is your job; a wrong reading
either drops a good offer or shows the candidate one they cannot take.

## The candidate's criteria

$INPUTS.criteria

## What the checks established (and the decision the rule computed)

$INPUTS.produced

## Read

1. `$ARTIFACTS_DIR/$INPUTS.posting` — the posting, completely.
2. `$ARTIFACTS_DIR/$INPUTS.out` — the extraction.
3. `$ARTIFACTS_DIR/decision.json` — the decision and its reasons.
4. The candidate's profile, when its file name is not empty: `$INPUTS.profile` (in
   `$ARTIFACTS_DIR`). Empty: there is no profile, `core_requirements` is empty and the fit was
   not assessed; nothing to judge there.

## What is blocking

- A language the posting requires of the candidate that the extraction misses, lists as
  `preferred`, or dismisses in `not_required`.
- A language listed as `required` when the posting only calls it a plus, nice to have or an
  advantage (that would drop a good offer).
- A salary misread: wrong period (monthly read as yearly), wrong currency, a bonus or an
  on-target total read as base pay when the base is given, an amount that is not this
  role's pay, or a stated pay the extraction calls absent.
- A wrong `posting_language`: the job description is written in another language than the
  one declared (page menus in the site's language do not count).
- A wrong `work_mode`: the posting places the role in an office, hybrid or on site, and the
  extraction says `full_remote` or `not_stated` (the candidate only takes fully remote work);
  or a fully remote role read as hybrid or on site; or a `work_mode` quote that does not state
  the work mode (a city alone, "remote-friendly", a benefit line).
- A wrong `experience`: the posting asks for N years ("7 ans d'expérience", "5+ years in",
  "3 à 5 ans") or names a level of this role ("profil senior", "Senior …" in the title) and
  the extraction says less, says nothing, or dismisses it in `ignored`; or years read as a
  requirement when the posting only speaks of itself ("nous avons 10 ans d'expérience"), of
  another role ("reporting to a senior manager"), or of a contract length (that would drop a
  good offer); or a quote that does not carry the number or the label declared.
- A wrong `hiring_zone` (when `zone_embauche` is `europe`): the posting keeps the role to a
  zone outside Europe ("US only", "must reside in the US", "LATAM") and the extraction says
  `open` or `not_stated`; or a role open to Europe, EMEA or anywhere read as `closed` (that
  would drop a good offer); or a quote that does not say where the role hires.
- A free criterion marked met or not met against what the posting says.
- An unfaithful `core_requirements` (profile given). You verify the reading; you do not decide
  the outcome (the rule does: two `missing` reject, one is a note). Blocking: the three entries
  are not what the role is built around (a secondary "nice to have", a language, the pay or a
  soft skill listed while a central hands-on requirement of the posting is left out); a
  `missing` the profile actually backs (a good offer dropped); a `backed` or `partial` whose
  profile quote does not show that skill (a related word, another channel, a different tool:
  "social media" for "paid buying on TikTok"); a `backed` that the profile only shows at a far
  lighter level than asked (that is `partial`).
  Tools are the candidate's call, not yours: a named tool or software (Klaviyo, Shopify,
  HubSpot, Salesforce…) is never a core requirement, and the skill behind it is backed by any
  tool that does the same job (Brevo or Mailchimp back e-mail automation asked "on Klaviyo";
  a site built and shipped backs "running a Shopify store" as `partial`). Blocking: a core
  entry that is only a tool name, or a `partial` / `missing` that rests only on the profile
  naming another tool than the posting. Never blocking: the profile not naming the posting's
  tool. A tool the posting names that `tools_requested` leaves out is minor.
- A quote taken out of context so that it says the opposite of the posting.

Minor: wording of the summary, a redundant entry, a quote longer than needed.

Not yours to judge: the publication date. "offre trop ancienne (publiée le …, > N jours)" comes
from the offer's board date and `offre_age_max_jours`, by code; judge the reading of the posting
as for any other offer.

Read only: do not edit any file.

## Declare

- `approved` — `true` only when there is no blocking finding.
- `reason` — one or two sentences, in French, a person reads as the verdict.
  (The rule's decision is not yours: approve a faithful reading even when it rejects the offer.)
- `findings` — each with `severity` (`blocking` or `minor`) and `text` (what is wrong, where,
  what the posting actually says). Empty when there is none.
