# arandano-worker

> OCI image that runs a single arandano task in isolation.

This image bundles [sandcastle](https://github.com/mattpocock/sandcastle), [superpowers](https://github.com/obra/superpowers), and a small Node helper that enforces TDD and quality gates before opening a PR. It's launched by the [arandano](https://github.com/nmunozsi/arandano) CLI; you probably don't run it directly.

## Status

Pre-alpha. See the [arandano design doc](https://github.com/nmunozsi/arandano/blob/main/arandano-design.md) §15 for the worker's preflight contract.

## License

MIT.
