# Manual install

What `install.sh` / `install.ps1` do, step by step, for people who prefer to see each command.

```
git clone https://github.com/lt20/reelbook ~/reelbook
cd ~/reelbook
python3 -m venv .venv && .venv/bin/python -m pip install pillow     # crop.py / vstack.py find this venv by themselves
ln -s "$PWD/skill/reelbook" ~/.claude/skills/reelbook                # Windows: copy the folder to %USERPROFILE%\.claude\skills\reelbook
python3 tools/rb.py login --url … --key …                            # copy the exact command from the app's Settings page
```

The URL and key are your backend's. For the hosted backend they are `hosted.url` and `hosted.anonKey` in the app's
published [config.js](https://lt20.github.io/reelbook/config.js): that is where the installers read them when they
are run without `--url` / `--key` (as text, the file is never run). The Settings page's
« Already installed, sign in again » line carries them too.

`rb.py` itself needs only the standard library. Updating later: `git pull` in `~/reelbook`
(Windows: copy the skill folder again).
