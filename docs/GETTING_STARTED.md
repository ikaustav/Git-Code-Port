# Getting started with Git Code Port

This guide walks you from zero to your first saved snippet. It takes about 10 minutes. You need **Google Chrome** (or Edge or Brave) and a **GitHub account**.

**Steps:** [1. Download](#step-1-download-the-extension) · [2. Unzip](#step-2-unzip-it-into-a-folder-you-keep) · [3. Install](#step-3-install-it-in-chrome) · [4. Pin](#step-4-pin-the-extension) · [5. Create a token](#step-5-create-a-github-access-token) · [6. Connect](#step-6-connect-the-extension-to-github) · [7. Choose a repository](#step-7-choose-where-to-save) · [8. Save your first snippet](#step-8-save-your-first-snippet) · [9. Find it again](#step-9-find-your-saves-later) · [Problems?](#if-something-goes-wrong)

---

## Step 1: Download the extension

1. Open **https://github.com/ikaustav/Git-Code-Port**.
2. Click the green **Code** button (above the file list).
3. Click **Download ZIP**.
4. Your browser saves a file called `Git-Code-Port-main.zip`, usually in your **Downloads** folder.

> Know Git? You can run `git clone https://github.com/ikaustav/Git-Code-Port.git` instead and skip Step 2.

## Step 2: Unzip it into a folder you keep

Chrome runs the extension **from this folder**, so put it somewhere permanent, not in Downloads, where it might get cleaned up.

- **Windows:** right-click the ZIP → **Extract All…** → choose a folder such as `Documents\Git-Code-Port` → **Extract**.
- **macOS:** double-click the ZIP. Move the new `Git-Code-Port-main` folder into `Documents`.
- **Linux:** `unzip Git-Code-Port-main.zip -d ~/Documents`

Open the folder and check that you can see a file called **`manifest.json`**. That is the folder you will choose in the next step. (If you only see another folder inside, go into it until you find `manifest.json`.)

## Step 3: Install it in Chrome

1. In the address bar type **`chrome://extensions`** and press Enter.
   *(Edge: `edge://extensions`, Brave: `brave://extensions`)*
2. Turn on **Developer mode** with the switch in the **top-right corner**.
3. Three new buttons appear. Click **Load unpacked**.
4. Select the folder that contains `manifest.json` (from Step 2) and click **Select Folder** / **Open**.
5. A **Git Code Port** card appears. Make sure its switch is **on** (blue).

A Git Code Port **Settings** tab opens by itself. Leave it open; you need it in Step 6.

> Chrome may show a banner about developer-mode extensions. That is normal for extensions installed from a folder.

## Step 4: Pin the extension

1. Click the **puzzle-piece icon** 🧩 to the right of the address bar.
2. Find **Git Code Port** and click the **pin** 📌 next to it.

The Git Code Port icon now stays in your toolbar.

## Step 5: Create a GitHub access token

The extension needs permission to save files into your repository. You give it this with a **fine-grained personal access token**, a key that only works for the repositories you choose.

> **No repository yet?** On GitHub click **+** (top right) → **New repository**, give it a name such as `coding-notes`, tick **Add a README file**, and click **Create repository**.

1. In the Settings tab from Step 3, click **GitHub → New fine-grained token ↗**.
   *(Or open https://github.com/settings/personal-access-tokens/new. Sign in if asked.)*
2. Fill in the form:

   | Field | What to enter |
   |---|---|
   | **Token name** | Anything you recognise, e.g. `Git Code Port` |
   | **Expiration** | A short period, e.g. **90 days**. You can make a new token later. |
   | **Resource owner** | Your own account (or the organization that owns the repo) |
   | **Repository access** | Choose **Only select repositories**, then pick your repo(s) from the list |
   | **Permissions → Repository permissions → Contents** | Change **No access** to **Read and write** |

   Leave everything else as it is. **Metadata: Read-only** is added automatically; that is expected.
3. Scroll down and click **Generate token** (confirm if GitHub asks).
4. **Copy the token now.** It starts with `github_pat_`. GitHub shows it **only once**. If you lose it, just create a new one.

> Treat the token like a password: don't paste it into chats, screenshots or code.

## Step 6: Connect the extension to GitHub

1. Go back to the Git Code Port **Settings** tab.
   *(Closed it? Click the Git Code Port toolbar icon → **Settings**.)*
2. Paste the token into **Personal access token**.
3. Optional: tick **Remember on this device** if you want to stay connected after closing the browser. If you leave it unticked, you paste the token again after a browser restart; that is the safer choice.
4. Click **Connect**.

You should see **Connected as *your-username***.

## Step 7: Choose where to save

On the same Settings page, under **Defaults**:

1. **Default repository:** type it as `your-username/repo-name`, e.g. `octocat/coding-notes`.
2. **Default branch:** usually `main`.
3. **Folder template:** leave `{language}` to sort code into folders like `Python/` and `JavaScript/`.
4. Click **Save defaults**.

Easier: toolbar icon → **Open workspace (side panel)** → **Repos** shows every repository your token can save to. Click **Make default** on yours. You can also pick a different repository in the Review window each time.

## Step 8: Save your first snippet

1. Open any webpage with code or text, e.g. a Stack Overflow answer.
2. **Select** the part you want to keep with your mouse.
3. **Right-click** the selection → **Git Code Port** → **Save selection (auto-detect)**.
   Other ways: press **Alt+Shift+G**, or click the toolbar icon → **Capture selection**.
4. A **Review** window opens. Check:
   - **Category** and **Language** (detected for you),
   - **Filename** and **Folder**,
   - **Repository** and **Branch**,
   - **Commit message**.
   Change anything you like. You can also edit the content itself.
5. Click **Review & push →**. You see exactly what will be saved and where.
6. Click **Push to GitHub**.
7. Done. Click **View on GitHub ↗** to see your file.

**If a file with that name already exists**, nothing is overwritten. You see what would change and can choose **Save as a new file**, **Back to edit**, or **Replace the existing file…** (asks you to confirm again).

**If you see a secret warning**, the content looks like it contains a password or key. Remove it, or tick the box to confirm it's safe before pushing.

## Step 9: Find your saves later

1. Click the toolbar icon → **Open workspace (side panel)**.
2. Open the **History** tab.
3. Type in the search box (title, language, tag, website, file path…) or use the filters.
4. Click an item to see its details. From there you can:
   - **View on GitHub**,
   - **Show versions** to list every saved version of the file,
   - **Compare with current** to see what changed in an older version,
   - **Restore…** an older version (saved as a new commit, so nothing is lost).

## If something goes wrong

| What you see | What to do |
|---|---|
| **"Manifest file is missing or unreadable"** when loading | You chose the wrong folder. Pick the folder that directly contains `manifest.json`. |
| Extension disappears after a restart | The folder was moved or deleted. Put it back (or unzip again) and repeat Step 3. |
| No **Git Code Port** item in the right-click menu | You must select text first. It doesn't work on `chrome://` pages, the Chrome Web Store or PDFs. |
| **"GitHub rejected the token"** | The token expired, was deleted, or was copied incompletely. Create a new one (Step 5) and connect again (Step 6). |
| **"Permission denied"** | One of these: **(1)** the token's **Contents** permission is not **Read and write**; **(2)** the repository was **not selected** under *Only select repositories*; **(3)** the branch is **protected** and doesn't allow direct pushes; **(4)** for an organization repo, the organization hasn't approved fine-grained tokens. Fix it on GitHub (Settings → Developer settings → Personal access tokens → edit the token), or make a new token, then connect again. |
| Your repository isn't in the list | The token doesn't include it, or you can't push to it. Edit the token's repository access, then click **↻** next to the repository list (Review window) or **↻ Reload** (side panel → Repos). |
| **"Branch does not exist"** | Check the branch name. New repositories need at least one file (e.g. a README) before they have a `main` branch. |
| **Alt+Shift+G** does nothing | Another app uses that shortcut. Change it at `chrome://extensions/shortcuts`. |
| Side panel buttons ask for permission | Chrome is asking whether the side panel may read the page when you click. Allow it, or use right-click instead. |

## Updating to a new version

Download the new ZIP, unzip it **over the same folder** (replace the files), then open `chrome://extensions` and click the **↻ reload** icon on the Git Code Port card. Your settings and history are kept.

## Removing it

`chrome://extensions` → Git Code Port → **Remove**. Then delete the token on GitHub (Settings → Developer settings → Personal access tokens → Fine-grained tokens → **Delete**). Files you saved stay in your repository.

---

More detail: [README](../README.md) · [Security and privacy](../README.md#security-and-privacy) · [Test report](TEST_REPORT.md)
