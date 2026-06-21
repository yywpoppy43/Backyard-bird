# Hardware Read

A small web app. Someone enters their date of birth and gets a plain-language
read of the structural friction their build repeats — then they can bring a
real-life friction and keep the conversation going.

The birthday is turned into a BaZi chart **in code** (exact, never guessed),
and that chart is handed to Claude with a system prompt that does the reading.
No accounts, no saving, no history. Refresh = start over.

---

## What's in here

| File | What it is |
|------|------------|
| `index.html` | The whole page someone sees (the form + the reading + the chat). |
| `api/chat.py` | The private back-end. It computes the chart and talks to Claude. Your API key lives here, on the server — never in the page. |
| `requirements.txt` | The two Python packages the back-end needs. |
| `vercel.json` | A little config so reads have enough time to finish. |

---

## Putting it live (about 10 minutes)

You'll use **Vercel** — a free host that can run both the page and the small
Python back-end together. You'll connect it to this GitHub repository once, and
from then on it redeploys automatically whenever the code changes.

### 1. Get an Anthropic API key
This is what lets the app talk to Claude.

1. Go to **https://console.anthropic.com** and sign in (or create an account).
2. Add a little credit (Billing) — reads are cheap, a few dollars goes a long way.
3. Open **API Keys → Create Key**, and copy the key. It starts with `sk-ant-`.
4. Keep it somewhere safe for a moment. **Don't paste it into any file or the page** — it goes into Vercel's settings in step 3.

### 2. Connect the repo to Vercel
1. Go to **https://vercel.com** and sign up with your GitHub account.
2. Click **Add New… → Project**, find this repository, and click **Import**.
3. Leave all the build settings as their defaults and click **Deploy**.
   (The first deploy will finish but the reads won't work yet — that's the next step.)

### 3. Add your API key to Vercel
1. In your new project, open **Settings → Environment Variables**.
2. Add the Claude key:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** the `sk-ant-…` key you copied

   To also enable the **Gemini** toggle, add a second variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your Google Gemini API key
   - (Optional `GEMINI_MODEL` — defaults to `gemini-3.1-pro`; set this only to
     change the Gemini model without touching code.)
3. Save.
4. Go to the **Deployments** tab → open the latest one → **Redeploy** so it
   picks up the key.

### 4. Open it
Vercel gives you a link like `your-project.vercel.app`. Open it on your phone,
enter a birthday, and you should see a read appear in a few seconds. Send that
link to anyone — it just works in a browser.

---

## A few good-to-knows

- **The key stays private.** It lives only in Vercel's settings and is used by
  the back-end. It is never in the page and never sent to anyone's browser.
- **Cost.** Each read is a single short call to Claude (the model
  `claude-sonnet-4-6`). It's inexpensive; you can watch usage in the Anthropic
  console.
- **No data is stored.** There are no accounts and nothing is saved. Closing or
  refreshing the page starts over.
- **If reads stop working,** it's almost always the API key — check that
  `ANTHROPIC_API_KEY` is set in Vercel and that the Anthropic account has credit.

---

## Running it on your own computer (optional)

You don't need this to go live, but if you ever want to test locally:

```bash
# one-time setup
pip install -r requirements.txt
npm i -g vercel

# set your key for this terminal session, then run
export ANTHROPIC_API_KEY=sk-ant-your-key
vercel dev
```

Then open the address it prints (usually `http://localhost:3000`).
