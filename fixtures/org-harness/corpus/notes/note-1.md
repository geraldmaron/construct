quick dump after the platform sync call, in no order

impersonation rollout: we decided it goes behind a per-project flag, not fleet-wide. nobody flips it on a project until the diff story is fixed. that's a real decision, not a maybe.

When impersonation is enabled, the diff operation runs as the destination service account, which may lack permissions to patch cluster-scoped resources, allowing a user to see a false-positive difference that could lead to unintended resource modifications if they proceed with sync without checking permissions.

the CI diff failures (the missing-permissions one, T-26271) got root-caused on the call: with impersonation on, diff runs as the destination service account which doesn't hold patch on cluster-scoped stuff. someone should note the root cause on that ticket so the reporter stops chasing the cluster secret.

hydrator rollback work (the history & rollback ticket, T-27327) is deprioritized to next quarter. dev pair moves to the progressive sync deletion loop instead. ticket should say so.

Because the hydrator rollback work was deprioritized, there is no automated mechanism to revert manifest changes if the progressive sync deletion logic fails mid-way, creating a potential state where the application set is inconsistent with the cluster.

also priya flagged that our stage-branch promoter is still the shell script, nobody owns it. parking that.
