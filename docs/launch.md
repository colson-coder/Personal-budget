# Launch kit

Everything needed to put Babylon's Purse in front of people. Items marked
**[you]** need the owner's decision or account. Everything else is ready.

---

## 1. The pitch

**One line:**
> A free money app that pays you first: it saves a part of everything you earn,
> tracks side income and taxes, and works in any currency.

**Two sentences:**
> Most budget apps show you where your money went. Babylon's Purse decides
> where it goes before you spend it. It saves first, budgets the rest, and keeps
> tax money aside for side income, in any currency.

**What sets it apart** (from the competitor research):

| | Babylon's Purse | Typical budget apps |
|---|---|---|
| Price | Free core | Often a monthly subscription |
| Pay-yourself-first plan | Built in (10% by default) | Manual |
| Side income and tax set-aside | Built in, any country | Rare |
| Multiple currencies | Each entry at its own day's rate | Often one currency |
| Coach | A "next step" from classic money principles | Charts only |
| Privacy | Works without an account (device only) | Account and bank login required |

## 2. Who it's for (start narrow)

1. **People with a side hustle or freelance income:** they need the tax
   set-aside, and few apps do it.
2. **People earning or spending in two currencies:** expats, digital nomads,
   remote workers, and people who travel often.
3. **Readers of *The Richest Man in Babylon* and similar books:** the name and
   the "keep a tenth" rule speak directly to them.

## 3. Where to post (in this order)

| Where | Angle | Notes |
|---|---|---|
| Friends and family (10–20 people) | "Try it for a week and tell me what's confusing" | Do this first. Fix what they hit before going public. |
| r/sidehustle, r/freelance | "I built a free tracker that sets aside tax on side income" | Read each subreddit's self-promotion rules first. Lead with the problem, not the app. |
| r/digitalnomad, r/expats | "Budgeting in two currencies without spreadsheets" | Show a screenshot with EUR and USD. |
| r/povertyfinance, r/budget | "A free pay-yourself-first budget, no bank login needed" | The free, private angle. |
| Product Hunt | The full launch, with demo link and screenshots | Plan a weekday morning, Pacific time, and be around all day to reply. |
| Indie Hackers / Hacker News ("Show HN") | The build story: a no-build web app with an open-source engine | HN likes the privacy and no-build angle. |

**Every post links to:** https://colson-coder.github.io/Personal-budget/welcome.html.
Its **Try the demo** button opens sample data instantly, so no sign-up is
needed to look around.

**Draft Reddit post** (r/sidehustle):
> **I kept forgetting to set aside tax from side gigs, so I built a free app that does it for me**
>
> When a client pays me, I log it in one tap and the app tells me how much to put
> aside for tax. It also saves 10% of everything I earn before I can spend it (the
> old "Richest Man in Babylon" rule). It works in any currency and doesn't need a
> bank login, and there's a demo with sample data so you can poke around first:
> [link]
>
> It's free. I'd love to hear what's confusing or missing.

## 4. Before going public: checklist

- [x] Landing page with real screenshots and a demo
- [x] Works on iPhone, Android and desktop; installable
- [x] Sign-in fixed (database permissions)
- [ ] **[you]** A **privacy policy** and short **terms**. A draft is in
      `docs/privacy-draft.md`; it needs a contact email. Both are required for
      Product Hunt and any app store, and expected by users.
- [ ] **[you]** A **contact or feedback channel**, e.g. a dedicated email or a
      simple form, so a "Send feedback" link can go in Settings.
- [ ] **[you]** Optional: your own **domain** (e.g. babylonspurse.com, about
      $12 a year). It looks more trustworthy than a github.io address. GitHub
      Pages supports custom domains for free.
- [ ] Optional: privacy-friendly visit counts (e.g. Plausible or GoatCounter) to
      see whether posts bring visitors. This needs an account. **[you]**
- [ ] Ask 3–5 testers to try the iPhone purchase shortcut.

## 5. Premium: a proposal (for discussion, nothing built)

**Principle:** the core tracker stays free forever. People pay for things that
cost money to run or that save real time.

| Free (everything that exists today) | Premium (proposed) |
|---|---|
| Budgets, funds, debts, taxes, reports | **AI coach chat**: ask questions in your own words (costs about 1–2¢ per question to run) |
| The rule-based coach | **Live bank sync** (US first, via a provider; costs per connected account) |
| Bank file import, auto-logging card purchases | **Shared household**: two people, one budget |
| Multiple currencies, sync across devices | **Priority support** |

**Price to test:** about **$4/month or $36/year**. That's well under the
$10–15/month that the big subscription budget apps typically charge (check
current prices before quoting them anywhere). A **lifetime** option
(e.g. $79) often sells well with early adopters.

**How payments would work:** a "merchant of record" such as **Lemon Squeezy**
or **Paddle** handles sales tax and VAT in every country, which suits a global,
multi-currency audience better than raw Stripe. The app would check a
"premium" flag on the user's account through a small Supabase function, so
the browser can't fake it. **[you]**: create the account; this needs your
business and tax details.

**Suggested order:** launch free → collect feedback for a few weeks → add
Premium with the AI coach first. It's already built and just needs switching on.

## 6. Open questions for the owner

1. Is the target audience in section 2 right, or is there a group you'd rather
   start with?
2. Do you want your own domain name?
3. Which contact email should go in the privacy policy and on a feedback link?
4. Do you agree with the Premium proposal (what's in it, about $4/month), or
   should we stay completely free for now?
