# Sharp Lambda Layer

Provides the [Sharp](https://sharp.pixelplumbing.com/) image-processing library
with its **linux-x64** native binary, for the Image Intelligence Engine
processing Lambdas (background removal, per-channel packaging).

## Layout

Lambda layers for Node.js expect dependencies under `nodejs/node_modules`:

```
layers/sharp/
  nodejs/
    package.json        # declares sharp
    node_modules/       # populated at build time (linux-x64 binary)
```

## Build

Sharp ships platform-specific native binaries, so the layer must be built for
the Lambda runtime (linux-x64), NOT the developer's OS:

```bash
cd services/image-intelligence/layers/sharp/nodejs
npm install --os=linux --cpu=x64 --libc=glibc sharp@0.33.5
```

The CDK stack references this directory via `lambda.Code.fromAsset`. In CI the
build step above runs before `cdk synth`/`cdk deploy`. The `node_modules`
directory is git-ignored; it is produced by the build, not committed.

## Why a layer (not bundled)

Per design decision #3: Sharp's native binary is provided via a layer so the
handler bundles (esbuild) stay small and don't attempt to bundle a native
`.node` binary. The processing Lambdas list `sharp` as an external module.
