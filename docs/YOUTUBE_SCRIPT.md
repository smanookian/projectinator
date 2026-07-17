# Projectinator — YouTube walkthrough script

A ~7–9 minute demo video. Format: `[ON SCREEN]` = what the viewer sees, `[SAY]` = spoken
line. Keep it fast, show real spend, be honest. **Do not demo web-login** (ToS/ban risk) —
lead with API keys.

---

## 0. Cold open — the hook (0:00–0:15)

`[ON SCREEN]` Terminal. Type one sentence into Projectinator, hit enter. Jump-cut through
the board filling in, then the finished app open in a browser.

`[SAY]` "I typed one sentence — *a todo app with localStorage* — and a team of AI models
planned it, built it across three files, tested it in a real browser, and handed me working
code. For about fifteen cents. Let me show you how."

---

## 1. What it is (0:15–0:55)

`[ON SCREEN]` The home screen of the cockpit. Slowly pan the menu.

`[SAY]` "This is Projectinator. The idea is simple: *you're the project manager, and your
dev team is a roster of AI models.* Instead of one model doing everything, each job goes to
the model that's best and cheapest for it — planning, design, code, testing. And you run the
whole thing from a terminal cockpit: a live board, a budget bar, a standup. It's built on the
Pi agent harness, it's open source, and you bring your own API key."

`[SAY]` "Quick heads-up: this spends *your* API money. Every screen shows the running cost,
and you set a budget cap. I'll keep it on screen the whole time so you see exactly what it costs."

---

## 2. Build something, live (0:55–3:30)

`[ON SCREEN]` Home → New build. Type: `a recipe manager — add recipes, search, mark favorites, save to localStorage`.

`[SAY]` "Let's build something real. I'll ask for a recipe manager."

`[ON SCREEN]` The **stack** step appears (Web → React / vanilla / let-AI-decide).

`[SAY]` "First it asks what to build it with. I'll pick React — and note this is CDN React,
no build step, so it just runs. Vanilla's here too if you want zero dependencies."

`[ON SCREEN]` The **intake** questions appear (what kind of recipes, which features…).

`[SAY]` "Now the PM does something I really like — because my request was a little vague, it
asks a couple of clarifying questions first. Not fifty. Just enough to build the *right* thing.
This is the difference between an agent guessing and a PM checking."

`[ON SCREEN]` The **plan mode** choice: Quick vs Deep.

`[SAY]` "Then it asks *how* to plan. Quick is one PM. But watch this — I'll pick **Deep plan**."

`[ON SCREEN]` The **council** spinner, then the approved-epics screen.

`[SAY]` "This runs a little planning council. An architect, a product lead, and a risk lead
each propose the epics from their own angle — in parallel — and a synthesizer merges them.
Look: the risk lead added a whole epic for empty states and edge cases that a single planner
usually forgets. I approve the epics…"

`[ON SCREEN]` The plan screen: task count, **estimated cost**, budget cap.

`[SAY]` "…and it expands them into a full backlog with a cost estimate up front. Fifteen
tasks, estimated about a dollar. Under my cap. Let's build."

`[ON SCREEN]` The **building** board: tasks flip design→code→test, spinners, budget bar climbing.

`[SAY]` "And here's the cockpit doing its thing. Design specs first, then the developer writes
the actual files, then — and this is the important part — the tester doesn't just *read* the
code. It loads the app in a headless browser and fails if there's a JavaScript error. If a
test fails, it kicks the work back to the developer with the bug report and re-runs. A real
feedback loop."

`[ON SCREEN]` Build completes. Open in browser. Add a recipe, favorite it, refresh (localStorage persists).

`[SAY]` "Done. Here's the app. Add a recipe… favorite it… refresh — still there, localStorage
works. Total spend, bottom of the screen. That's the whole loop: idea to working app."

---

## 3. The cockpit tour (3:30–6:30)

`[SAY]` "But the build is only half of it. The reason I call it a cockpit is everything around it."

`[ON SCREEN]` Project screen → **📊 Retro**, then **🧠 Generate AI narrative**.

`[SAY]` "Every build gets a retro — cost by epic, cost by model, which tasks were priciest,
what the tester flagged. And I can have it write a plain-English retro: what went well, what
to improve, next time. All grounded in the real numbers."

`[ON SCREEN]` **📉 Burndown** — the two ASCII charts.

`[SAY]` "Burndown — tasks remaining and spend over the build."

`[ON SCREEN]` **📜 History** → **↩ Undo last task**.

`[SAY]` "The whole workspace is a git repo — one commit per task. So I can see the history,
diff any step, and even *undo* a task and rebuild just that piece."

`[ON SCREEN]` Home → **🆚 Compare models** (bake-off). Run a design task across Opus/Sonnet/Haiku. Show the results table.

`[SAY]` "And here's my favorite. This was the founding idea — a model bake-off. Run the same
task across models, an LLM judge scores the results, and you get cost, speed, and quality side
by side. Look — for design, Sonnet actually beat Opus at similar cost, and Haiku was five
times cheaper. One click saves the winner as the model for that role. You're not guessing
which model to use — you're measuring."

`[ON SCREEN]` Project screen → **🚀 Deploy** menu (Cloudflare/Vercel/Netlify). *Optionally* deploy.

`[SAY]` "When it's ready — one command deploys it to Cloudflare, Vercel, or Netlify. And you
can export the backlog straight to Jira or Trello if you're running this alongside a human team."

---

## 4. Under the hood, briefly (6:30–7:15)

`[ON SCREEN]` Quick cut to `README.md` / the module map, or Settings → model assignments.

`[SAY]` "Two ideas make it work. First: roles bind to a *capability and tier*, never a model
name. There's a swappable registry mapping capabilities to models — new frontier model drops
next month, you change one place, every route updates. Second: it estimates cost in code,
because models are famously bad at guessing their own token use — and those estimates
self-calibrate from your real runs. You can see the accuracy in Settings."

---

## 5. Cost + honesty (7:15–7:45)

`[ON SCREEN]` Settings → Preferences (budget cap + alert %). Then the exit screen with session cost.

`[SAY]` "One more time on cost, because I think it matters: you set a hard cap, it warns you
before you hit it, and it halts before it crosses it. That recipe app? Here's the real number.
No surprises. It's your key, your money, always on screen."

---

## 6. Outro + CTA (7:45–8:15)

`[ON SCREEN]` GitHub repo page. Star button. Your channel end card.

`[SAY]` "Projectinator is open source — link in the description. Clone it, bring your own key,
build something. If you want to see me build the next feature — I'm thinking multi-file
frameworks with a real build step — subscribe, and tell me in the comments what you'd have
your AI dev team build first. Thanks for watching."

---

## Shot list / B-roll checklist

- [ ] Cold-open jump-cut (type → board → finished app)
- [ ] Stack picker, intake questions, plan-mode choice
- [ ] Council spinner → approved epics (call out the risk-lens epic)
- [ ] Building board with the budget bar climbing
- [ ] App working in browser + localStorage persistence on refresh
- [ ] Retro + AI narrative, burndown, history/undo
- [ ] Bake-off results table (the Sonnet-beats-Opus moment)
- [ ] Deploy menu + (optional) a real deploy to a live URL
- [ ] Settings: model assignments, estimate accuracy, budget cap
- [ ] Exit screen with session cost

## Do / don't

- **Do** keep the running cost visible; it's the trust builder.
- **Do** show a real failure/retry if one happens — it's more convincing than a clean run.
- **Don't** demo or mention web-login / "use your paid ChatGPT for free." It's ToS-violating
  and risks the account; it stays parked. Lead with API keys.
- **Don't** show your actual API key on screen (it lives in `~/.projectinator/config.json`).
