## AR experience link: never break it

Every shirt is printed with a QR encoding `https://shop.inrl.co/p/<claim_code>`. Printed shirts
can't be updated, so that link must keep opening the shirt's AR after every change.

Do not change, without the user's explicit go-ahead for that specific change:
- the `/p/:code /viewer?piece=:code 302` rule in `_redirects` (and nothing earlier may shadow it);
- `viewer.html` reading `?piece=` and calling `/api/viewer/piece?code=`;
- `apiViewerPiece`'s response fields (`mindurl`, `videourl`, `imageurl`, `version`, …) and its
  rule that it works for anyone, even when the product is unpublished or the target inactive;
- `pieceLink` (`<PUBLIC_SITE_URL>/p/<code>`), `garment_units.claim_code` values, or anything that
  deletes or renames shirts or their targets.

Before finishing any change, run `npm test`; `test/ar-link-contract.test.mjs` must pass. If it
fails, fix the change, never the test. A new QR style must still pass `test/qr-emblem.test.mjs`
and be checked with a real decoder before it ships.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
