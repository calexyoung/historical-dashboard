import { buildVariant } from "../tests/built/builds";

export default function setup(): void {
  if (process.env.ATLAS_SKIP_BUILD === "1") return;
  buildVariant("local-atlas");
  buildVariant("local-staging");
}
