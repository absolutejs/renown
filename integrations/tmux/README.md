# Renown tmux HUD

Codex does not currently expose a Claude-style command-backed footer. The first-party
workaround is tmux's own status line, using plain tmux config and the Renown CLI:

```tmux
source-file ~/.renown/tmux-status.conf
```

Generate and install that snippet with:

```bash
renown install-agent tmux
```

The generated file is:

```text
~/.renown/tmux-status.conf
```

It sets `status-interval` to 5 seconds and prepends:

```tmux
#(renown statusline)
```

to tmux `status-right`. This is intentionally not a plugin and does not depend on a
third-party wrapper. Remove the single `source-file ~/.renown/tmux-status.conf` line
from `~/.tmux.conf` to disable it.

