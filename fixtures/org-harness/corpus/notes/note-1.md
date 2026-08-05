quick dump after the platform sync call, in no order

impersonation rollout: we decided it goes behind a per-project flag, not fleet-wide. nobody flips it on a project until the diff story is fixed. that's a real decision, not a maybe.

the CI diff failures (the missing-permissions one, T-26271) got root-caused on the call: with impersonation on, diff runs as the destination service account which doesn't hold patch on cluster-scoped stuff. someone should note the root cause on that ticket so the reporter stops chasing the cluster secret.

hydrator rollback work (the history & rollback ticket, T-27327) is deprioritized to next quarter. dev pair moves to the progressive sync deletion loop instead. ticket should say so.

also priya flagged that our stage-branch promoter is still the shell script, nobody owns it. parking that.
