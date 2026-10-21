# Batch commands

In **Hosts**, select the servers you want and choose **Run command**. You can use Ctrl/Cmd-click to select hosts, or Ctrl/Cmd+A to select the filtered list. The group context menu also has **Run command on group…**, which targets the whole group even when the host list is filtered.

Review the target list, uncheck any hosts you want to exclude, then enter a command or choose a saved snippet. Choose **Run on N hosts**. Multiline commands are supported.

Results show live output, stderr labels, status and exit code separately for each host. Expand or collapse each result to inspect its output. **Edit command** returns to the form without executing anything. Running again requires another explicit click on **Run on N hosts**.

Each host uses a separate SSH connection with the saved authentication method. Connect normally first to verify its server key. Unknown or changed keys fail the batch operation for that host; they are never accepted automatically.

Commands run through SSH exec without a PTY. Interactive prompts, including sudo password prompts, are unsupported. A command starts in the account's default remote directory and does not inherit the working directory or environment of an open terminal tab.

Limits:

- One batch at a time, with up to 100 hosts and 4 simultaneous connections.
- Timeout is enabled by default at **1 hour per host**, including connection and authentication. In **Settings → Terminal → Batch commands**, set a duration from 1 to 10080 minutes or turn the timeout off entirely. With it off, Azalea imposes no execution deadline or SSH inactivity limit. Settings apply to new runs; the dialog shows the timeout used by the current run.
- At most 64 KiB of command text and 1 MiB of output per host.
- Output remains in the dialog until it is closed or edited; it is not saved to disk or synced.

**Stop batch** cancels queued hosts and closes active SSH connections. Switching accounts or closing all SSH sessions also cancels the batch. Closing a connection, reaching the output limit or timing out cannot guarantee that the remote process stops. Check the remote service before repeating a command with side effects.

A missing exit status is reported as an unknown outcome, never as success. A failure on one host does not prevent the remaining hosts from running.
