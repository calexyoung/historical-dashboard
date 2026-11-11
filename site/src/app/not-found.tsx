import type { Metadata } from "next";
import { Panel } from "@/components/Panel";
import { BASE_PATH } from "@/lib/config";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Panel id="not-found" title="Page not found" level={1}>
      <p className="max-w-[60ch] text-ink-2">
        There is no page at this address.{" "}
        <a href={`${BASE_PATH}/explore`} className="press hover-ink text-accent underline underline-offset-2">
          Go to Explore
        </a>
        .
      </p>
    </Panel>
  );
}
