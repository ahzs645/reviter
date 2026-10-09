The Node checkpoint runner isolates expensive independent tasks in a bounded
worker pool. It never changes indoor geometry, permissions or source approval.
The synchronous compiler remains available.

```ts
const binding = await createCheckpointBinding({
  immutableInputs: [{ name: 'snapshot', path: '/absolute/frozen-input.v8' }],
  algorithmFiles: transitiveAlgorithmFilesIncludingWorkerAndResolver,
  algorithmVersion: 'native-plane-v1',
});
const run = await runBoundedCheckpointTasks({
  binding,
  workerModule: new URL('./native-circulation-plane-worker.ts', import.meta.url),
  checkpointDir: '/absolute/candidate/checkpoints',
  tasks: planes.map(plane => ({
    id: plane.id,
    input: { elevationFeet: plane.elevationFeet },
    estimatedMemoryBytes: 256 * 1024 * 1024,
  })),
  maxWorkers: 2,
  workerMemoryBytes: 2 * 1024 * 1024 * 1024,
  maxInFlightBytes: 5 * 1024 * 1024 * 1024,
  workerResourceLimits: { maxOldGenerationSizeMb: 2048 },
});
for (const ref of run.results) {
  const planeCarrier = await readCheckpointResult(ref);
  // Validate/decode exact topology, then merge in original task order.
}
```

The worker module exports `initialize(context)` and
`runTask(input, initializedState, context)`. `readVerifiedInput(name)` reads and
checks the bound bytes before decoding; it does not stringify a model. V8 bytes
are suitable for original model snapshots. Exact Rational results must first
be explicitly encoded in a lossless topology carrier. Generic task inputs and
results admit only plain JSON: prototypes, BigInt, nonfinite numbers, -0,
accessors, implicit `toJSON`, symbols and sparse arrays are rejected. The runner
does not use structuredClone to serialize Rational instances.

Pass the complete transitive algorithm closure, including the worker and any
Node resolver hook. Both runner/bootstrap files are automatically bound too.
The worker module must be in that manifest. Current file bytes are checked
before initialization and after completion. Immutable inputs should be frozen
candidate snapshots, not files being edited by another compiler.

Each task checkpoint binds the full input/algorithm manifest, task identity,
exact task JSON checksum and result checksum/size. Its fully written temporary
file is fsynced and renamed atomically; the directory is fsynced. Corrupt,
incompatible or incomplete task checkpoints are recomputed. Completed tasks
survive worker failure and SIGKILL. Locks contain fully persisted PID metadata
before appearing; dead runner locks can be recovered under an exclusive
recovery gate. Live locks are never removed. A process killed during the tiny
recovery-gate operation leaves an explicit recovery-lock error, rather than
silently taking another potentially active owner.

Results are ordered file references, not every plane retained in memory at
once. Decode one verified checkpoint at a time. Declared base-worker plus
in-flight-task accounting bounds concurrency and validates input/result byte
sizes. V8 resource limits separately cap each heap. This accounting is not an
OS RSS guarantee: native/external allocations and the eventual merged dataset
still need realistic caller estimates and performance measurement. Parent TS
loader/strip flags are preserved; process-only V8/TLS/snapshot flags are not
passed to Worker.

Checkpoint integrity is not geometry certification. A merged native result
still requires complete source, enclosure, floor/opening, access, path and
current geometry binding validation before export or navigation.

Run generic regressions with:

```sh
node --experimental-strip-types --test tests/bounded-worker-checkpoints.test.ts
```
