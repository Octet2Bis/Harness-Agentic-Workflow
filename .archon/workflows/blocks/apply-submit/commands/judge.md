# Judge (apply-submit)

You are the judge of a submission. You did not see it happen: you only see the offer,
the candidate sheet, the two JSON records and the two screenshots, and what the
deterministic checks established (fields filled, CV attached, confirmation pattern
found or not). Your job is what code cannot decide: was the application sent, to the
right employer, with the right data, and does the receipt actually prove it?

## The offer

$INPUTS.offer

## The candidate sheet and the sources of every answer

Read `$INPUTS.candidate` completely. Also read, when the path is not empty:

- `$INPUTS.answers_file` — `reponses_formulaires.md`, the answers Antoine validated (one per
  `## <question>` heading; `Variantes :` other labels, `Choix :` options for a list);
- `$INPUTS.profile` — the master profile;
- `$INPUTS.letter` — the cover letter given to the block (empty: there is none).

## What the checks established

Prefill: $INPUTS.prefill

Receipt: $INPUTS.receipt

## The pieces

Read `$ARTIFACTS_DIR/$INPUTS.out_dir/prefill.json`, `receipt.json`, and open the images
`prefill.png` and `receipt.png`.

## How to judge

- Right target: the `final_url` and the page belong to the employer of the offer (or to
  its ATS), not to another job or another company. The code already refused any host off
  the allowed list; you judge whether the page is this employer's form for this job.
- Right data: every value in `fields` matches its `source` (name, e-mail, links from the
  sheet). A wrong e-mail is blocking.
- Nothing invented. A free-text answer (motivation, salary, notice period, work
  authorisation, relocation…) comes word for word from `reponses_formulaires.md`, from the
  master profile, or from a factual field of the sheet; a cover-letter or message field
  holds the pitch or the letter. The code checked free-text fields it recognised; you check
  the rest, choices included: a list or radio answer to such a question (visa: "No",
  relocation: "Yes") must be backed by one of these sources (`Choix :` of the matching
  entry, the profile, the sheet). An answer composed by an agent, or a claim no source
  supports, is blocking.
- Fields left empty and listed in `unanswered` ("à remplir par Antoine") are not a finding:
  Antoine may have filled them himself at the go, and they then show filled on
  `receipt.png`.
- Cover letter: when `$INPUTS.letter` is not empty and the form had a cover-letter field
  (`cover_letter_field` in `prefill.json`), the letter is attached there (or its text, else
  the pitch, is pasted in a text field), and the resume / CV field holds the CV, never the
  letter.
- Proof: the receipt screenshot shows a confirmation a person would recognise (message,
  changed page, acknowledgement). A pattern match in the text is not enough if the
  screenshot shows an error or the untouched form. When the click happened but the
  proof is weak, say so: `approved: false` with a blocking finding that names what the
  human must check (mailbox, platform account).
- Read only. Do not open the browser, do not edit any file.

## Declare

Return exactly:

- `approved` — `true` only when the application was sent to the right employer with the
  right data and the receipt proves it.
- `reason` — one or two sentences a person can read as the verdict.
- `findings` — the list of findings, each with `severity` (`blocking` or `minor`) and
  `text`. Empty when there is none.
