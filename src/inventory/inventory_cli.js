/** Runs an inventory CLI entrypoint and formats usage-qualified errors cleanly. */
export async function runInventoryCLI(usage, main, argv = Bun.argv.slice(2)) {
  try {
    const exitCode = await main(argv);
    if (exitCode !== undefined) {
      process.exitCode = exitCode;
    }
  } catch (error) {
    console.error(`${error?.message ?? error}\n${usage}`);
    process.exitCode = 2;
  }
}
