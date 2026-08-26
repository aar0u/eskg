## Setup

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install
```

## Run

```bash
pnpm start
```

Options:

```bash
pnpm start -- --no-headless
pnpm start -- --email-provider emailfake
pnpm start -- --no-headless --email-provider mailticking
```

`--email-provider` defaults to `emailfake`.

> This Playwright implementation was ported from the Python code at commit `c0bee4295561b64d6a626d3de4ae2a3b41074d4d`