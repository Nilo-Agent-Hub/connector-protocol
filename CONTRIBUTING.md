# Contributing

Use this repository's [issues](https://github.com/Nilo-Agent-Hub/connector-protocol/issues) for protocol, SDK, conformance, and documentation work. This is a public repository: use public references and sanitized examples only; do not include private repository links, internal work items, credentials, or user data.

## Issue to delivery

1. Open a bug, feature, or maintenance issue with scope and verifiable acceptance criteria. Ideas may remain in the backlog until triaged. Small wording fixes can go directly to a PR.
2. Create an isolated branch or worktree from current `origin/main`, such as `fix/123-short-description` or `feat/123-short-description`; keep unrelated work separate.
3. Open a draft PR early. Describe the problem, resulting behavior, related issues, evidence, and compatibility implications; mark it ready after implementation and applicable checks.
4. Review the existing CI results for the current commit, resolve failures and pending acceptance, then merge into `main`, preferably with squash, and remove the merged branch. Unstarted, skipped, blocked, or failed CI is not a pass. A sole maintainer cannot approve their own PR; document self-review without presenting it as independent approval.
5. Follow the existing versioning and publication process, then record actual release and acceptance evidence. Merging and building do not authorize production deployment or operations on user accounts/devices.

For changes spanning repositories, use `Refs` for the overall public tracking issue and close it only after every deliverable and end-to-end acceptance is complete. Use `Closes #123` only for an issue fully delivered by that PR. Never link private implementation work from this repository.

## Repository checks

The [existing CI](.github/workflows/ci.yml) runs the following checks. Use the Go version in `go.mod`; CI uses Python 3.12 and Node.js 24.

```sh
go test ./...
go vet ./...
python3 conformance.py
python3 -m unittest discover -s python/tests -v
node --test typescript/test/*.test.mjs
npm exec --yes --package typescript@5.9.3 -- tsc -p typescript/tsconfig.json
python3 build_echo.py --output ./dist/echo-connector
python3 conformance.py --executable ./dist/echo-connector --manifest ./examples/echo.manifest.json
```

These checks use offline fixtures or a temporary loopback server. They require no model account or private checkout and do not establish production interoperability, publisher trust, or a security certification. Follow [DEVELOPING.md](DEVELOPING.md) and [SPEC.md](SPEC.md); describe wire compatibility, capability negotiation, and version implications for contract changes.

Record local commands/results and CI run links separately. Identify simulations, real runtimes/devices, and production acceptance explicitly; state skipped or unverified coverage. A passing build alone does not complete release acceptance.
