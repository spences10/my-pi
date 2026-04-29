# @spences10/pi-team-mode

Experimental Pi package for local team orchestration: create teams,
spawn RPC teammates, assign tasks, and send mailbox-backed messages
between members.

Install or test with Pi:

```bash
pi -e ./packages/pi-team-mode
```

Core command:

```text
/team create demo
/team spawn alice "claim one task and report back"
/team task add alice: inspect the failing test
/team dm alice status?
/team status
```
