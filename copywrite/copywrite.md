# InRL MVP website — design and development handoff

25 September 2026 · **Implementation brief.** This records Nicolas's approved page decisions and copy for the design and development team. It is not a claim that the launch build, catalogue, policies, or media are ready. Use the linked locked files as the authority if a transcription below differs.

## The assignment

Update the **existing** launch website designs and customer-facing build manually. Preserve the visual language and page structure of [INRL — FINAL](https://www.figma.com/design/RES5XfG4fvECtsvIPV8pZl/INRL---FINAL?node-id=1969-4887) except for the Home treatment specified below. Replace approved text exactly, fit it on desktop and mobile, and carry the new customer language through the other existing screens. Do not add pages, new content sections, synthetic reviews, or unsupported product features. The original Figma file is the visual reference; the [partial editable review copy](./FIGMA_REBUILD_STATUS.md) is **not** a complete implementation source.

The old live `inrl.co` site describes an earlier, more sophisticated product. It is historical context, **not** copy, functionality, or design authority for this launch. For the same-domain release, separately check redirects, old signup handling, and live URLs as needed; do not migrate old product promises into the new pages.

**Source order:** locked copy files below → this handoff for placement and scope → [brand copy rules](../brand/copy_rules.md) and [product experience](../brand/product_experience.md) → [Website content V2](./WEBSITE_CONTENT_V2.md) for *proposed* copy on unfinished screens. The [content map](./CONTENT_MAP.md) inventories the existing screens. This repository is the written source of truth; design and code should point back to the applicable file and status.

## Home — six visible, screen-sized sections

Approved reading order: **Hero → Manifesto → Film → 3 steps → Buying → Footer.** The current seven-area Figma has these first five areas in this sequence, followed by “Worn, and worn again” and the footer. Omit the testimonial area for MVP and bring the footer directly after Buying. Keep the announcement bar and header as shared page elements; they are not extra sections. Preserve each remaining area's visual structure and component behavior, adapting only for the approved copy and assets. In particular, the manifesto stays text-led and the film remains its own full-screen area.

| Area | Implement | Asset / fit note |
|---|---|---|
| 1. Hero | Use the [locked hero copy](./HOMEPAGE_HERO_V2.md) exactly; primary **Buy now**, secondary **See how it works**. | Use Marine's [separate ~16-second hero film](./HOMEPAGE_HERO_MEDIA_BRIEF.md), composed around existing copy; desktop landscape and purposeful mobile portrait versions, both clear without sound, plus poster/fallback. Check CTA destinations. |
| 2. Manifesto | Use the locked statement, label, and two paragraphs below. | No new image, carousel, or content block. Check line breaks and readable text fit on desktop and mobile. |
| 3. Full film | No added headline or explanatory body. Accessible play label: **Watch InRL in action** where the player needs one. | Use Marine's [distinct ~25-second film](./HOMEPAGE_VIDEO_BRIEF.md), with separate landscape/portrait treatment and a still fallback. It is not the hero cut reused. Include accessible description/transcript against the final film. |
| 4. Three steps | Use [How it works](./HOW_IT_WORKS.md) verbatim in the three existing cards, including **No app needed.** and **Buy now**. | Validate text fit and the three visuals against the actual purchase → owner video choice → QR/phone reveal flow. |
| 5. Buying | Retain the existing product/buy area. Replace **New arrivals** with the working heading **Choose your T-shirt.** Add **Add your video after checkout.** only if the existing supporting-text slot and verified flow support it. | Product cards, names, variants, prices, photos, and destination stay pending actual Printful selection. Use accurate launch product references; no guessed range or “bestseller” badges. CTA **Buy now** only if it reaches a real buyable offer; otherwise align its label with the real destination. |
| 6. Footer | Use the **same shared footer** on Home and About. Keep the existing email signup; see working copy and behavior gate below. | No new visual asset. Preserve required links and legal/business details. |

### Locked Home manifesto — paste exactly

**CULTURE MOVES.**  
**WHAT WE WEAR SHOULD TOO.**

**Why we made InRL**

There’s more than one side to each of us. What we love, make and care about changes as we do. We share so much of it online. What if it could start conversations in real life?

So we made InRL: clothing that brings your digital content into the real world. Choose what you share, change it when you want, and let people discover sides of you they might not see otherwise.

The approved manifesto uses **digital content** to express the brand idea. The launch product explanation elsewhere must be specific: a person chooses a **video** for a **T-shirt**, and someone else sees it **through their phone's camera**, not on a screen in the shirt. See [the locked source](./WEBSITE_CONTENT_V2.md).

### Shared footer — working wording, pending form check

Use the existing signup position and links. Proposed heading **Stay in the loop.**; explanation **Get InRL news and product updates by email.**; field **Email address**; action **Sign up**; success **You're on the list.**; failure **We couldn't sign you up. Please try again.** The proposed consent sentence in [Website content V2](./WEBSITE_CONTENT_V2.md) must match the real consent capture, privacy notice, list purpose, and unsubscribe flow before it is published. Do not promise a sending cadence or notifications when an owner's video changes. Match links to actual Shop, About, FAQ, Contact, policy, and account routes.

## About — four existing areas

Use the existing opening, full-width visual, three-card area, and shared footer. The opening and cards below are **locked** in [About page draft](./ABOUT_PAGE_DRAFT.md); preserve the wording. The existing “What we will not do” treatment becomes the positive, three-card **WHAT WE’RE HERE FOR.** section within the same area. The approved copy makes a possible real-life connection feel human; visuals should not promise that every scan starts a conversation.

**Opening small label:** About InRL

**Opening headline:**  
NOT EVERYTHING WE SHARE  
SHOULD STAY IN A FEED.

**Supporting label:** Why we made InRL

**Opening body:**

People meet you and see one version of you. They don’t see the music you’re into, the thing you made last night, or the clip that makes you laugh every time. That stuff usually stays on your phone.

So we made InRL. A clothing brand that lets you bring more of your digital self into the real world. Your T-shirt can share something you love, something you made, or something that just feels like you. And what it shares can change with you.

Someone sees what you’ve shared, then looks up at you. It might lead to a laugh, a conversation, or a shared experience neither of you expected. That’s the part we care about: real-life connection, starting with something personal.

**Full-width visual:** no on-page copy. Marine's [About visual brief](./ABOUT_VISUAL_BRIEF.md) calls for a self-contained excerpt or still from the Home full film, focused on the look-up and human response after a phone reveal. Do not replay the entire Home film unchanged. Product and phone details must be accurate before release.

**Three-card heading:** WHAT WE’RE HERE FOR.

| Card | Locked title | Locked body |
|---|---|---|
| 1 | Show more of you. | Some parts of you are easy to miss. Let people discover what you’re into, what you’ve made, or what makes you laugh. |
| 2 | People are the point. | The phone reveals the video. What matters is the person standing in front of you. |
| 3 | Keep changing. | Keep the T-shirt. Change the video whenever you have something else to share. |

For card imagery, follow [Marine's three-card brief](./ABOUT_THREE_CARDS_BRIEF.md) and the existing image slots. Check card height and reading order on mobile. Use the Home footer unchanged.

## FAQs — existing page, ten accordions

Implement the heading, introduction, and **all ten question/answer pairs verbatim** from [the locked FAQ file](./FAQ_FULL_SECTION_V3.md), which supersedes older eight-question drafts. The ten questions fit inside the *existing* accordion area, not a new section. Keep answers in readable, crawlable text; ensure accordion keyboard behavior, focus, labels, and mobile expansion work. Link “Contact us” and “Shipping and Returns” to the actual destinations. Do not shorten, merge, or rewrite a locked answer solely to fit the current eight-item mockup. Flag layout pressure for design review.

The FAQ wording is approved, but several underlying facts still need verification before publication: checkout/account association and video changes before delivery; QR → link → browser camera → print → video; who can access a video link; washing and marker recognition; and supported shipping destinations and estimates. If the build cannot substantiate one of these, resolve the product/flow gap or reopen that answer with Nicolas before going live. Do not silently change the agreed copy.

## Language pass across every other customer screen

Audit the live design **and** implemented strings, including mobile, empty/error states, metadata, transactional emails, and accessible labels. Make contextual changes; a global search-and-replace can break legitimate phrases such as “a piece of work” in FAQ answer 7. For customer-facing product language:

| Retire or constrain | Use in the appropriate context |
|---|---|
| “piece” for the product; “garment”/“tee” as the main product noun | **T-shirt**; use consistent casing and spelling. “Clothing” remains appropriate in the manifesto/About brand description. |
| “layer,” “AR layer,” “linked content,” “program the piece” | **video**, **choose/change your video**, **add a video to your T-shirt**. “Augmented reality (AR)” is useful in the explanatory FAQ answer. |
| “register/claim your piece,” a manual activation step | **Your T-shirts**, **Add your video**, or the actual owner action, once purchase-to-account association works. A missing purchase needs recovery/support, not a fictional second registration requirement. |
| “watch on the shirt,” “digital screen,” changing physical print | **see the video over the print through a phone's camera**; the physical print remains unchanged. |
| “scan it and it plays” | Where explaining mechanics: **scan the QR code → open the link → open/allow the camera → point at the print**. Short campaign copy may stay lighter if the detailed steps are nearby. |
| “no app” as a claim of zero setup or universal compatibility | **No app needed** means no separate InRL app download; the browser, internet, compatible camera, and permission may still be required. |

Apply the pass to these **existing** surfaces, using [Website content V2](./WEBSITE_CONTENT_V2.md) only as *working copy* outside the locked areas:

| Surface | Action for design/content/development | Status/gate |
|---|---|---|
| Announcement/header/navigation | Keep Home, Shop, About, Contact and actual utility destinations clear. Proposed announcement: **A T-shirt. A video you choose.** Verify current nav and links. | Working copy; no invented offer or launch date. |
| Shop, search, filters, product cards | Use **T-shirts** in the shop heading and search language. Keep only filters backed by real variants. Product cards show actual names, variants, prices, and accurate thumbnails. | Catalogue and Printful selection pending. |
| Product detail and size guide | Lead with the physical T-shirt, then briefly explain the owner-chosen video and phone view. Use actual colour/size/quantity controls and **Add to bag**. Fill fit, fabric, care, measurements, shipping, and returns only from approved facts. | Do not author final product copy or images from placeholder products. |
| Bag, checkout, payment, order confirmation | Replace legacy “piece/layer” language. Account explanation must match sign-in/create behavior. Confirmation can offer **Add your video** only when the bought T-shirt reliably appears in the owner's account. | Validate order/payment status and automatic association first. |
| Sign-in, account, owner/video management | Prefer **Your T-shirts**, **Your current video**, **Choose a video**, **Change video** for the controls that exist. Distinguish an actually empty account from a purchased T-shirt that failed to appear. Match upload, processing, success, and failure text to real states. | Existing account map is historical; recheck screens/build. “Studio” remains provisional. No invented video editor or manual claim flow. |
| QR viewer and camera states | Keep the viewer's instructions direct: **Open camera** and **Point your camera at the print** where those actions exist. Say plainly when the print is not found, camera is blocked, or a video is unavailable. | Validate on supported phones/browsers; no invented capture/share controls or blanket privacy promises. |
| Contact, confirmation, 404 | Use clear help language about a T-shirt, video, or order. The proposed strings are in V2; map them to actual form actions, validation, and routes. | No support response-time promise without service commitment. |
| Returns/shipping, terms/privacy, system emails | Replace obsolete product terms, then write factual policy and transaction language against real fulfilment, returns, data practices, and email triggers. | Still needs product, operational, and legal facts; no placeholders go live. |
| Titles/descriptions, image text, structured data | Align existing public-page metadata with the actual visible copy and verified products. Keep the main explanation and FAQs as HTML text, not only in images or video. | Proposed metadata in V2 is a starting point, not verified SEO research. No invented ratings or availability. |

## Assets and implementation acceptance

Marine owns the creative development in the linked briefs. The **hero and full film are two distinct launch assets**: approximately 16 seconds and approximately 25 seconds respectively, each designed to work muted with desktop landscape and mobile portrait versions and a still fallback. The About visual and card images may derive from the full film. The three-step visuals and product images must show the real sold T-shirt, print and tested phone experience. [F9 P1 priority list](./LAUNCH_P1_PRIORITY_LIST.md) is a working asset inventory; its old product counts and 8–15-second hero range do not override current decisions. Do not place unfinished concept frames or invented UI in launch media.

Before calling the work complete, review these outcomes in the **actual desktop and mobile build**, alongside the updated Figma screens:

1. The Home scroll has the six approved areas in order; no testimonial placeholder remains; the locked copy is exact; both videos have appropriate formats, fallback, sound-off clarity, and readable overlaid text. Hero and three-step CTAs reach real destinations.
2. About's opening, visual area, three cards and shared footer match the approved structure and wording. The FAQ has ten usable accordions with exact locked text.
3. Every existing customer screen has been checked for legacy nouns, misleading mechanics, dead links, and unsupported claims. Essential words remain selectable/readable text; controls and media have appropriate accessible labels, focus behavior, reduced-motion/fallback handling, and final-asset alt text or descriptions.
4. Owner purchase → account → video choice/change and viewer QR → browser camera → print → video journeys work as described on supported devices. Product, care, delivery, consent, privacy, and email claims are backed by actual implementation and policies.
5. Real launch products, variants, prices, images, QR/print artwork, product-specific copy, size data, and approved legal/policy text replace every placeholder before publication. Surface any mismatch to Nicolas instead of publishing an improvised claim.

**Delivery expected from the team:** updated desktop/mobile Figma frames, implemented pages and states, a list of copy/claim exceptions that need Nicolas's decision, final asset mapping, and a short QA record against the five checks above. No existing design measurement or token has been invented in this brief; take those from the approved Figma file and verify responsive fit there.
