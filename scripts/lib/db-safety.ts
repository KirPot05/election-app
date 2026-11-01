/**
 * Guards for destructive helpers: they only run against databases whose name
 * clearly marks them as disposable test databases.
 */
export function assertDisposableDatabase(url: string | undefined): string {
  if (!url) throw new Error("Database URL is not set.");
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("Database URL is not a valid URL.");
  }
  if (!/(test|e2e)/i.test(name)) {
    throw new Error(
      `Refusing to reset database "${name}": test helpers only run against databases whose name contains "test" or "e2e".`,
    );
  }
  return url;
}
