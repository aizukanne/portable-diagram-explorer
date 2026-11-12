# LG-1: check the presentation inside SharePoint's preview

**Who runs this:** the owner (it needs your SharePoint). **Time:** about five minutes.
**What it settles:** whether a presentation's drill-down windows now show their diagrams when the file
is opened in the SharePoint or OneDrive preview, and which of the two protections we built made it work.
**Where the answer goes:** a comment on GitHub issue #16. That issue stays open until you post it.

## Why this check exists

In version 1, opening a presentation in SharePoint's preview showed the overview, but every drill-down
window was empty. SharePoint's preview runs a file inside its own page and applies its own security
rules to it, and those rules blocked the small sealed frame that draws drill-down diagrams.

Version 0.2.0 has two protections. We could prove both only against a **model** of SharePoint that we
built ourselves, because the real thing is not available to the build. This check is the one test against
the real SharePoint, so until you run it, "works in SharePoint" is **unproven**.

1. **Pass the page's security stamp on.** If SharePoint stamps the page's scripts with a one-time code
   (a "nonce"), the presentation reads its own code and hands it to the sealed frame, so SharePoint's rules
   accept the frame. Nothing about the isolation of the frame is reduced.
2. **Draw in the page instead.** If the frame still has not started after 4 seconds, drill-down diagrams
   are drawn in the page itself. This is slightly less isolated, and the notice says so.

## Steps

1. Take the file `dist/sample/customer-platform.presentation.html` (built by `npm run build`; it is the
   sample project with a three-slide running order). Upload it to a SharePoint document library or OneDrive.
2. Open it from there in the browser preview (click the file, do not download it).
3. Check the strip under the toolbar. You should see a notice that begins "This presentation is being shown
   inside another site, which limits what it can do." At this point it does **not yet** say which path ran: the
   sentence about reduced isolation is added only after the first drill-down fails to start its sealed frame.
4. Click **Next** once. The counter should read "2 of 3" and the page should show "Identity service HLD".
   Then click the component named **Account association** on that diagram.
5. A drill-down window opens. Wait **at least 5 seconds** (the fallback starts after a 4 second deadline), then look
   again at the notice and write down its **exact text**. **This later reading is the one that decides which path
   ran.** If it now continues with "Drill-down diagrams are being shown with reduced isolation.", the fallback ran. If it
   does not, and the **Account association LLD** diagram image shows, the sealed frame worked. An empty window is a failure.
6. Open the browser's developer tools (F12), choose the **Console** tab, and copy everything shown (right-click,
   then "Save as…" or select all and copy). The presentation itself writes nothing to the console, so anything
   there comes from the browser, for example lines starting "Refused to load…" or "Refused to execute…".
7. Post to issue #16: the notice text read in step 5 (after the wait), whether the diagram appeared in step 5 (and how long it took),
   the console capture, and your browser name and version.

## How to read the notice

| What the notice says | What it means |
|---|---|
| After the drill-down and a 5 second wait: the first sentence only, **without** "reduced isolation" | Protection 1 held. The sealed frame started with SharePoint's stamp. This is the best result. |
| After the drill-down and a 5 second wait: the first sentence **and** "Drill-down diagrams are being shown with reduced isolation." | Protection 1 did not work here, and protection 2 (drawing in the page) ran. The diagrams still appear, after about 4 seconds. |
| No notice at all | The presentation did not detect that it is inside another page. Report this as a failure. |

## What counts as a pass

- The diagram image appears in the drill-down window, by either path, and the notice is shown: **pass**.
- The drill-down window stays empty after 10 seconds, or the notice is missing: **fail**. Post the same
  evidence. Do not retry with a different file; the console capture is what tells us which rule blocked it.

## What this check does not cover

Other hosts (Teams tabs, email previews, other document systems) and other browsers' previews are not tested.
Safari and Edge on real hardware are tracked separately in issue #12.
