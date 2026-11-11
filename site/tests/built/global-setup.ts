import { buildVariant, VARIANTS, type VariantName } from "./builds";

/** Build every variant once, unless a previous step already did (ATLAS_SKIP_BUILD=1). */
export default function setup(): void {
  if (process.env.ATLAS_SKIP_BUILD === "1") return;
  for (const name of Object.keys(VARIANTS) as VariantName[]) buildVariant(name);
}
