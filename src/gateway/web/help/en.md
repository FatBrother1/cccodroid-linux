# cccodroid help

cccodroid runs the **official, unmodified Claude Code** on Linux (a Steam Deck or a desktop distribution), wraps it in a graphical interface. Claude can read and write files, run commands and start local servers, just as it would in a terminal.

## Getting started

1. **Open the interface**: `cccodroid open`, or the cccodroid shortcut in Steam; the gateway starts with it.
2. **Sign in or add a key**: authorize your Claude account once in the browser, or enter a key for Anthropic, DeepSeek, Qwen or another compatible endpoint.
3. **Start a conversation**: tap ＋ in the top bar, or New chat in the sidebar.
4. **Put it to work**: Claude asks before editing files or running commands; switch the permission mode under the input bar.

## The screen

The right end of the top bar normally shows just ⋯. Tap it and the shortcuts you use most slide out to its left; tap it again (it is now ›) to tuck them away. The app remembers which way you left it.

| Button | What it does |
|---|---|
| 📁 | Files: browse, edit and preview files in the workspace |
| >_ | Terminal: the same environment Claude uses |
| 🌐 | Browser: local servers and links from replies; docks on the right on wide screens |
| ‹› | Command palette: slash commands, skills and common actions |
| ＋ | New conversation |
| ⋯ | Show or hide the buttons above |

The menu button at the top left opens the sidebar: places to go at the top (Chats, Projects, Scheduled tasks, with Extensions, Capabilities, Usage and Help under More), recent chats in the middle, and the account row at the bottom, which opens Settings.

The thin line under the top bar shows **context usage**; the further right, the fuller. Its second half shows what is left on the current provider: the share of the 5-hour and weekly limits used when you sign in with a Claude account, or the balance for DeepSeek, Kimi and similar. If a provider doesn't report its context window, fill in **Context window** for that custom provider under **Provider & model** in Settings, and the compaction line and scale follow it; without one the bar shows "capacity unknown". Tap the line for details; every provider’s quota and spending, plus low-quota reminders, are under **Quota and spending** at the top of the Usage page. In the input area, ＋ attaches files and opens common actions. The row below shows the model, thinking effort and permission mode; tap any of them to change it. The model picker only lists providers you can use: a Claude account that isn’t signed in is left out. To hide a provider you’ve set up, pick it under **Provider & model** in Settings and turn off **Show in the model picker** (its settings are kept, and the one in use is always listed).

## Make it yours

- **Appearance**: Settings → General → Appearance offers five styles: Native, Qiusuo, Zhuyue, Construct and Material, each in light and dark. Construct has square corners, heavy ink lines and red on kraft paper, for when you want something bolder; Material derives its whole palette from a seed color (set your own under Accent color).
- **Accent color**: Settings → General → Accent color offers eight presets or a color of your own. It's adjusted for the current appearance, so it stays readable in light and dark.
- **Buttons under messages**: in Settings → General, tap the ones you don't use (bookmark or fork, say) to hide them; your messages and Claude's replies are set separately.
- **Top bar buttons**: Settings → General → Top bar buttons. Each button can be Pinned (always on the top bar, no need to tap ⋯ first), In ⋯, or Hidden. Hold the handle on the left and drag to reorder. Restore default puts everything back.
- **Fonts**: the interface and replies can each use a different font. Under Settings → General → Imported fonts, import a ttf / otf / woff / woff2 file, then pick it with Custom… on the row you want. Characters the font lacks (say, Chinese in a Latin font) fall back to the built-in fonts. Code and the terminal always use the built-in monospace font.
- **Saved prompts**: save long prompts you send often and pick them by typing / in the input box; see Extensions below.
- **Sidebar shortcuts**: Customize pinned items… at the bottom of More in the sidebar.

These choices are stored in the app's own data (`~/.local/share/cccodroid/home`).

## Conversations

- **Enter sends.** Sending while Claude is busy queues the message; ⚡ interjects into the running turn without stopping it.
- `/` opens slash commands and `@` references a file. You can also drag a file into the window to attach it.
- The top row of ＋ next to the input box has two tiles: Attach file and Browse files. The actions below include the model, context and cost shortcuts.
- Tool calls collapse into one line such as "3 steps · done"; tap to see each step. Steps that need you, or that failed, open on their own.
- **Subagents** get their own card below the steps that launched them: one row per subagent with its status, step count and what it's doing; tap a row to open its steps. At the bottom, the message log shows "who → whom · what about". Each subagent's brief and report are saved under `.cccodroid/agents/` in the project folder; tap "Brief" or "Report" to read them.
- Paths in replies open in the viewer; web links open in the in-app browser.
- Every message has four buttons. Yours: copy, resend, rewind to here, delete. Claude's: copy, download, fork from here, delete.
- **Rewind to here** first lists the files changed since, then lets you undo just the code, or the code and the conversation. Files changed by shell commands are not restored.
- `/goal <condition>` keeps Claude working turn after turn until the condition is met. Background tasks and the task list appear above the input box, and each can be stopped; several background tasks fold into one line, tap it to expand.
- Conversations that were running when the gateway restarted or the window was closed are marked "Interrupted" in the list; open one and tap "Continue" to pick it up. Each has its own.
- **Misc**: throwaway sessions such as trying a model or saying hi are filed under "Misc" by Claude when it catalogs them. They stay out of the sidebar and appear as the last group on the Chats page; pinned ones and ones that are running or waiting for your confirmation still show in the sidebar. If a session Claude put in Misc gets compacted once or grows past 512 KB, it goes back to its normal group automatically. Sessions you moved there yourself with "Move to Misc" stay put; "Remove from Misc" brings any session back.
- The Chats page searches message content, filters, and exports or imports zips. Deleted chats stay in the trash for 30 days.

## Permissions and safety

| Mode | Behaviour |
|---|---|
| Ask me (default) | Reads freely; asks before editing files, running commands or going online |
| Accept edits | Edits without asking; still asks before commands |
| Plan | Reads and plans only, and acts once you approve |
| Auto | Claude's classifier decides what needs asking (experimental) |
| Deny unasked | Anything that would need approval is refused; for unattended runs |
| Allow everything | Never asks; only when you trust the task completely |

**What "Allow everything" really means.** Claude stops asking and edits any file or runs any command directly, including deleting things, going online and sending data out. The main risk is not Claude itself but what it reads: web pages, downloaded files, other people's repositories and issues can hide instructions aimed at the AI (prompt injection) that tell it to read your keys, change settings or upload something. In "Ask me" mode you see that step and can refuse; with "Allow everything" that check is gone. So:

- Turn it on only for a clear task where you know which files it will touch, and switch back afterwards.
- Leave it off when Claude is reading unfamiliar web pages, repositories or files of unknown origin.
- "Confirm sensitive actions" (Settings → Claude behaviour, on by default) is a safety net: when Claude is about to read keys or sign-in credentials (.env, SSH keys, API keys, the gateway token and so on), a red-bordered card asks you even under "Allow everything". If you see one and did not ask Claude to do that, deny it. It only recognises the obvious forms and can be sidestepped on purpose, so do not treat it as insurance for "Allow everything".

- Approval cards appear under the tool that needs them, and a bar above the input box keeps them in view. Allow, always allow, or deny with an optional reason. Approving a request never loosens the mode; change that in Settings.
- If Claude enters plan mode by itself while "Allow everything" is on, tap "Approve, keep current mode" on the plan card: that turn goes back to your previous mode and the global setting stays as it was.
- When the window isn't in front, a desktop notification tells you when a turn ends or needs you (requires `notify-send` on the system). Notifications can only deny; to allow, come back and read the full command.
- Closing the window only hides the interface; the gateway and any running turn keep going. To stop the gateway, run `cccodroid stop`. Scheduled tasks still run on time.
- Keys stay in `~/.local/share/cccodroid/home`. Account sign-in is handled by Claude Code itself; the app never touches your credentials.

## Projects and scheduled tasks

A **project** is a working folder with its own instructions (CLAUDE.md) and default model, effort and permissions. Conversations started in a project run in that folder and pick up its instructions automatically.

- Sidebar → Projects → New project: create a folder in the workspace, use an existing folder, or clone from git. With an existing folder, conversations you started there before are added automatically.
- The welcome screen of a new conversation lets you pick a project; a project tag then appears under the input box.
- Long-press an existing conversation (or tap ⋯) and choose Move to project; its record moves along.
- The filter bar on the Chats page can show one project, or only conversations created by scheduled tasks (marked with a clock).

A **scheduled task** runs Claude once on this machine at the set time. Nobody is there to ask, so anything that needs your approval is denied. Start with read-only for a few days before giving it more.

- Daily, weekly, monthly, every few hours, once, or a cron expression. The form shows the next two run times as you edit.
- For "don't bother me unless something's up": have it reply with one fixed phrase when nothing is found (e.g. "All green") and set notifications to Only when something is found.
- You can cap cost and duration per run, and set a daily total. Most third-party APIs don't report cost, so cost caps don't apply to them.
- The timer lives in the gateway: tasks run on time while the gateway is running. If the machine is off or asleep, the run is missed and handled by the task's If missed setting next time; it's never made up silently.

## Lineage

The Lineage page in the sidebar draws all your sessions as a subway map: time runs left to right, each line is a session, grouped into bands by project. In a narrow window it becomes an indented tree. On your first visit, tap "How to read" at the top right. The two-minute tour uses sample data and never touches your sessions.

- **Stations and archive numbers.** Each compaction ends a chapter and adds a station to the line. "a1b2·3" is an archive number: the first four characters of the session ID · the chapter. Tap a station to jump to the start of that chapter.
- **Where titles come from.** The model in the chat titles each chapter itself, from what was actually done in it rather than your first message; the session list shows the latest chapter's title. For a new chat, the app writes a title in the background right after the first reply, and it shows up a few seconds later. Choose the model for this, or turn it off, under Auto-title in Settings → Provider & model. To rename a chat, just ask the model, or long-press it in the list and rename it yourself; a name you set is never overwritten.
- **Where a line comes from.** A line branching off another midway is a fork. One that turns back at the branch point is a rewind. One that flows in with an arrow is a merge. Old chapters without a title show their first prompt in gray; "Backfill titles" in the toolbar names them all at once.
- **Merging.** When several sessions each got halfway and you want to carry on in one new session: select a line, tap "Merge…" on its card, check the other sessions, then tap "Next". The wizard has three steps: for each source, choose its compaction summary or a few hand-picked turns; write one line about what comes next; preview the first message (you can edit it). Once sent, a line flows into the new session from each source.
- **Add sources, fork from here.** Under "More…" on the card: sessions where you once pasted a hand-off by hand have no inferable source, so link them with "Add sources…", and undo if you got it wrong. "Fork from here" branches a new session from this session's latest turn.
- **Archive references.** Write "see a1b2·3" in a message and the compaction summary from the end of that chapter is attached for Claude (it doesn't show in your bubble). Up to three per message. If that chapter is still open and has no summary yet, Claude is told where the session file is so it can read it if needed.
- **Drill down.** "Drill down" on the card lays a session out turn by turn: when each turn ran, how many tool calls it made, how many subagents it sent, how many errors. Sessions forked off a turn hang under it; tap one to drill into it. Tap a turn to see every tool call (the light part is thinking before the call, the dark part is the tool running) and how long each subagent ran, with nested subagents indented. The back button steps out one level at a time.
- **Export.** "Export" in the toolbar saves the current map as an image (PNG), a vector file (SVG), or a single-file web page you can pan and tap (HTML), then lets you save it elsewhere.

## Files, terminal, browser

- **Files and viewer**: edit and save code in place; if the file changed on disk, you are asked before saving. Markdown, images, PDF and HTML preview directly, and HTML reloads when it changes. UTF-16 and GBK files open read-only so they don't get corrupted on save. Word and Excel open as is; for PPT and old .doc files, download them and open them with software on your system.
- **Terminal**: multiple tabs, plus a row of Esc, Tab, Ctrl and arrow keys. It keeps running when the panel is closed.
- **Browser**: type `127.0.0.1:port` to open a local server. ↗ hands the page to the system browser; sign-in pages always open there.

## Large screens and split screen

Layout follows the window width, not orientation:

- Narrow: one column; files, terminal and browser cover the screen.
- Wide (≥ 840): chat plus a workspace on the right; drag the divider, double-tap to reset.
- Wider (≥ 1000): the sidebar stays docked on the left, and its edge can be dragged too.

## Third-party endpoints

Check which protocol the endpoint speaks:

- **Anthropic protocol** (the address usually ends in `/anthropic`, or the provider says it is for Claude Code): Settings → Provider & model → "＋ Add a custom endpoint…", then fill in the address, key and default model name. **You can leave the model list URL empty**: the app then looks for `/v1/models` and `/models` on the same host as the API address, and if it finds a list you can pick models from it. If the provider doesn't publish a list, typing the model name still works.
- Services that only offer the OpenAI protocol (`/v1/chat/completions`) need a translating proxy. This build doesn't ship one; look for an Anthropic-compatible endpoint from the provider, or run a converter elsewhere and add it as an Anthropic endpoint.
- **Context window**: enter what the provider really supports for this model (`256k`, `1m` or an integer), or leave it empty for 200k. A larger number doesn't make the model bigger; it only makes compaction come too late.
- **No response from upstream**: custom endpoints wait 90 seconds for response headers and retry 3 times, so a stalled upstream shows retries under the bubble instead of hanging at "Connecting". To change it, set `API_TIMEOUT_MS` in the endpoint's `extraEnv`.
- 401 usually means the key belongs to another provider or has stray spaces; 429 is rate limiting or quota. If text works but images or tools fail, the model itself probably doesn't support them; narrow it down in a new text-only conversation.

## Extensions

- **Saved prompts**: create one under Saved prompts on the Extensions page: give it a name (say, issue) and write what should be sent to Claude. Then type `/issue your details` in the input box, and the text after the name fills `$ARGUMENTS`. A prompt can be for all projects or just the current one. They're stored as standard Claude Code command files, so claude in the terminal can use them too.
- **Plugins, skills, MCP**: add and manage them on the Extensions page; changes apply from the next message. More → Capabilities shows everything Claude can use this turn.
- **GitHub CLI**: the GitHub card on the Extensions page signs in to `gh` (device-code flow); the token stays in gh's own configuration.

## Updates and repair

- **Auto-update** (on by default): Claude Code updates silently; a new app version is offered for install once it has downloaded.
- App updates go through `cccodroid update`: the sha256 and release signature are checked before anything is replaced. The previous version directory is kept as is, so `cccodroid rollback` can go back; `cccodroid prune` cleans up old versions.
- A failed update leaves the version in use untouched; if one is interrupted, run it again.

## Troubleshooting

If the interface won't open, the gateway won't start, the logs flood the screen or the disk is full, run `cccodroid doctor` (read-only): it checks the gateway service, port, process ownership, log size, permissions, Qt, disk and old versions, each with a fix. `cccodroid logs` shows the gateway log; `cccodroid status` shows the service state.

If a hook, plugin or CLAUDE.md breaks things, turn on **Safe mode** under Settings → Claude behavior. Nothing custom is loaded until you turn it off again.
