export function cx(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
