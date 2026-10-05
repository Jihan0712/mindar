# InRL FAQs — full-page copy proposal

23 September 2026 · **APPROVED COPY — locked by Nicolas.** This supersedes the eight-question recommendation in `FAQ_RECOMMENDED_V2.md`. It contains **10 questions for the existing FAQ accordion area**, as Nicolas explicitly allowed more than eight. Do not rewrite the approved wording unless he reopens it. The existing page heading, campaign image area, footer, Figma and code remain unchanged. Source design: [UI-07 FAQs](https://www.figma.com/design/RES5XfG4fvECtsvIPV8pZl/INRL---FINAL?node-id=1732-1520) / M-08 FAQs. **Locking copy is not approval to publish unverified claims:** the checks below still apply.

## Proposed page copy

### Page heading

THINGS PEOPLE ASK FIRST.

### Short introduction

Questions about your T-shirt, video or order? Start here. Still stuck? Contact us.

### 1. What is InRL?

InRL makes T-shirts that you can connect to a video you choose. Anyone who scans the QR code can see that video over the print through their phone’s camera. You can change it from your phone.

### 2. How does an InRL T-shirt work?

Someone scans the QR code on your T-shirt, opens the link, then opens the camera and points it at the print. Your video appears over the print on their phone in augmented reality (AR). The T-shirt itself has no screen.

### 3. Do I need to download an app?

No. You choose and change your video in your phone’s browser. Viewers open the experience in theirs. They may need to allow camera access, but there’s no separate InRL app to download.

### 4. Do I need an account?

You’ll need an account to choose or change the video on your T-shirt. Someone viewing it doesn’t need to sign in.

### 5. How do I add a video to my T-shirt?

When you buy your first T-shirt, you get an account where you can choose and change its video. You can add a video before the T-shirt arrives. Once your video is ready, anyone who scans your T-shirt can see it.

### 6. Can I change my video later?

Yes. Open your account and choose a new video. The print stays the same; the video changes.

### 7. What can I share on my T-shirt?

You can share a video you made or have permission to share. It could be a memory, a piece of work, or something you’re into.

### 8. Who can see my video?

Anyone who scans the QR code can open the video linked to your T-shirt.

### 9. Can I wash the T-shirt?

Yes. Follow the care instructions on the label to protect the print. The video isn’t stored in the fabric, but the print needs to stay clear for the phone experience to work.

### 10. Where do you ship, and when will my order arrive?

We ship internationally. Delivery times vary by location. See Shipping and Returns for current destinations and estimates.

## Editorial rationale and publication gates — not page copy

Ten questions cover the natural sequence for an unfamiliar product: **what it is → how it works → owner actions → visibility/care → ordering**. The mechanism answer explicitly says the shirt has no screen, so it does not need a second, near-duplicate “Does it have a screen?” accordion. “Do I need an app?” and “Do I need an account?” stay separate because one concerns the viewer and the other the owner. The resale question is deferred until transfer and former-owner video rules exist. The return question is also deferred: a link-only answer would not answer it; add it when the approved policy can state eligibility and the first step plainly.

1. Confirm the QR → link → browser camera/permission → print → video behavior, supported devices, account association, pre-delivery choice and change flow in the launch build. The first seven answers describe intended behavior, not a certified implementation. The phrase “once your video is ready” avoids promising instant publication before processing is verified.
2. Confirm actual upload formats/limits and make them available in the upload flow. Add a short format/size line here only if it helps customers decide before purchase and matches the implemented rules.
3. Decide and document the video visibility/access model before publishing answer 8. Nicolas confirms that anyone who scans the QR may view; also verify whether forwarded links work, whether the page is indexed, and what controls the owner has. Do not imply the QR link is private or unshareable.
4. Confirm wash-care guidance and test marker recognition after washing before publishing answer 9. Nicolas's principle is that the print must remain intact; the copy avoids a blanket guarantee, but “Yes” still needs product testing and a real care label.
5. Confirm supported shipping destinations with the fulfillment partner and publish real estimates before answer 10 goes live. Nicolas's “all regions” direction is rendered as “internationally” because literal worldwide coverage may have exclusions. The dedicated Shipping and Returns page must list the actual destinations and delivery ranges.
6. Check fit of 10 accordions on desktop/mobile. The added questions use the **existing FAQ area**, not a new page section, but their height and footer transition must be reviewed before implementation.

For SEO and AI search, the answers should remain visible, crawlable page text and use customer wording without repetitive keywords. Google says its ordinary search fundamentals apply to AI features and special GEO markup is unnecessary; the FAQ rich-result feature was removed in 2026. These are editorial reasons to answer real questions well, not promises of ranking or citation. Sources: [Google AI-features guidance](https://developers.google.com/search/docs/appearance/ai-features), [people-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content), and [Google documentation updates](https://developers.google.com/search/updates) (June 2026).
