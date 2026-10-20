# Publish the prepared npm release

Package: `homebridge-trane-home`, version `0.1.0`, Apache-2.0.
Source: https://github.com/jbolles5/homebridge-trane-home

The source and compiled tarball are released on GitHub. npm publication is a
separate step and is pending. Use an npm account authorized to publish this name;
GitHub authentication does not authenticate npm. Complete npm's login and MFA
prompts directly; do not place tokens in the repository or chat.

## Verify and package

From the repository root, with Docker running:

```sh
mkdir -p artifacts
docker compose run --rm dev npm ci
docker compose run --rm dev npm run lint
docker compose run --rm dev npm test
docker compose run --rm dev npm run build
docker compose run --rm dev npm pack --pack-destination artifacts
docker compose run --rm dev node test/package-smoke.mjs
docker compose run --rm dev npm publish ./artifacts/homebridge-trane-home-0.1.0.tgz --access public --dry-run
shasum -a 256 artifacts/homebridge-trane-home-0.1.0.tgz
```

Compare the checksum with the release's SHA256SUMS before publishing the
prepared artifact. The dry run does not publish or establish registry ownership.
The tarball contains compiled JavaScript, types, schema, documentation, and
license notices. It has no production npm dependencies.

## Authenticate and publish

These commands use a dedicated Docker volume to retain npm login state outside
the source tree. Run interactively and follow the login prompts:

```sh
docker run --rm -it -v trane-npm-publisher:/root node:24.20.0-bookworm-slim npm login --registry=https://registry.npmjs.org/
docker run --rm -it -v trane-npm-publisher:/root -v "$PWD/artifacts:/packages:ro" node:24.20.0-bookworm-slim npm publish /packages/homebridge-trane-home-0.1.0.tgz --access public
```

Run the second command only when ready for public npm publication. An npm
name/version pair cannot be reused after publication. Confirm the version with
`npm view homebridge-trane-home version` in the same Docker runtime, then update
the README and installation guide to mark npm availability. Verify Homebridge UI
search/install after registry indexing. Homebridge verification is a separate
process; this release does not claim Verified status.

To remove retained login state when finished:

```sh
docker volume rm trane-npm-publisher
```
