# Silvertongue

A talk-your-way-in heist game. Each vault is an AI character guarding a secret word; the thief has a few messages to make it slip, then one guess.

Live build: https://claude.ai/artifact/JinMmxQN9VZqa9d7dReGLf

## Modes

- **Campaign (solo):** eight hand-written vaults of rising difficulty. Crack each one yourself by chatting, or send your thief agent. Fewer messages earn more stars, and cracking a vault unlocks the next.
- **Your crew:** write your thief's playbook and your vault's character in plain language. Test your vault against three house thieves.
- **Arena (async online):** post your vault so others can raid it while you're away, send your thief at rival vaults, and climb the "toughest vaults" and "best thieves" leaderboards.

## How it runs

`index.html` is a single-file claude.ai artifact (no build step). It uses the artifact runtime's capabilities:

- `sample`: the vault and thief characters, run on the viewer's own Claude account (no API key).
- `db`: Arena vaults (`vaults/<uid>`) and heist results (`heists/<uid>`). Everyone can read them, and each player writes only their own document. Saves live privately under `data/users/<uid>/save`.
- `user`: player ids and display names for the leaderboards.

Each heist draws a random secret word, so vault instructions guard "the secret" rather than a fixed word. Table rules force a vault to keep talking (1–4 sentences per reply), so it can't win by going silent.

Opened outside claude.ai, the page renders but the characters can't talk.

## Known limits (prototype)

- Matches run in the attacking player's browser, so Arena results are on the honor system. A real release needs a server-side match runner.
- Vault instructions are readable by attackers' browsers.
- No content moderation on player-written instructions yet.
