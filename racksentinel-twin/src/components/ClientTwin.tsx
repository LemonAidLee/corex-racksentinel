"use client";
import dynamic from "next/dynamic";

/** The scene uses canvas, WebAudio and window APIs: load it on the client only. */
const TwinApp = dynamic(() => import("./TwinApp"), {
  ssr: false,
  loading: () => (
    <div className="loading" role="status">
      <span className="loading-mark" aria-hidden="true" />
      Starting RackSentinel twin…
    </div>
  ),
});

export default function ClientTwin() {
  return <TwinApp />;
}
