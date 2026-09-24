"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOutIcon,
  ImagesIcon,
  PlayIcon,
  SpeakerSimpleHighIcon,
  SpeakerSimpleXIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// The post in OUR card, adapted from OneUp Insights' ReelPlayer.
//
// CLICK TO PLAY, NEVER AUTOPLAY: until clicked the tile is one poster image
// and the mp4 is not even referenced, so a page of cards costs a poster each.
// The poster and mp4 come from /api/reel (Instagram's free embed page), fresh
// each time, because Instagram's signed URLs die within ~a day and a half.
//
// Posts whose owner blocked embedding come back empty; for those the tile
// offers "Load preview", which asks for that one post through Apify (costs
// credits, so it's never automatic).

type Resolved = { videoUrl: string | null; posterUrl: string | null; isVideo: boolean };

export function shortcodeOf(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,32})/);
  return m ? m[1] : null;
}

export function ReelPreview({
  url,
  kind,
  className,
}: {
  url: string;
  kind: "reel" | "carousel";
  className?: string;
}) {
  const shortcode = shortcodeOf(url);
  const [media, setMedia] = useState<Resolved | null>(null);
  const [failed, setFailed] = useState(false);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!shortcode) return;
    let live = true;
    fetch(`/api/reel/${shortcode}?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Resolved) => {
        if (live) setMedia(d);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [shortcode, kind]);

  const loadDeep = async () => {
    if (!shortcode) return;
    setDeepLoading(true);
    setDeepError(null);
    try {
      const r = await fetch(`/api/reel/${shortcode}?kind=${kind}&deep=1`);
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      if (!d.posterUrl && !d.videoUrl) throw new Error("Instagram didn't return any media");
      setMedia(d);
      setFailed(false);
    } catch (err) {
      setDeepError(err instanceof Error ? err.message : "Couldn't load");
    } finally {
      setDeepLoading(false);
    }
  };

  const toggleMute = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const playable = Boolean(media?.videoUrl);
  const empty = failed || (media !== null && !media.posterUrl && !media.videoUrl);

  return (
    <div className={cn("relative aspect-[9/16] overflow-hidden rounded-lg bg-black", className)}>
      {playing && media?.videoUrl ? (
        <video
          ref={ref}
          src={media.videoUrl}
          poster={media.posterUrl ?? undefined}
          className="size-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          controlsList="nodownload"
        />
      ) : media?.posterUrl ? (
        // A plain <img>: next/image would need Instagram's CDN whitelisted in
        // next.config.ts, which a poster thumbnail isn't worth.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-secondary px-3 text-center">
          {!shortcode ? (
            <span className="text-[11px] text-muted-foreground">Not an Instagram post link</span>
          ) : empty ? (
            <>
              <span className="text-[11px] leading-snug text-muted-foreground">
                Instagram blocks the preview for this post
              </span>
              <button
                type="button"
                onClick={loadDeep}
                disabled={deepLoading}
                title="Fetches this one post through Apify (uses a few credits)"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-60"
              >
                {deepLoading && <SpinnerGapIcon className="size-3 animate-spin" />}
                Load preview
              </button>
              {deepError && <span className="line-clamp-3 text-[10px] text-destructive">{deepError}</span>}
            </>
          ) : (
            <SpinnerGapIcon className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      )}

      {/* One click starts it, another stops it; the whole tile is the target. */}
      {playable ? (
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Stop" : "Play"}
          className="absolute inset-0 grid place-items-center outline-none transition-colors hover:bg-black/15 focus-visible:bg-black/15"
        >
          {playing ? null : (
            <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              <PlayIcon weight="fill" className="size-4" />
            </span>
          )}
        </button>
      ) : null}

      {kind === "carousel" && media?.posterUrl && (
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <ImagesIcon weight="fill" className="size-3" /> Carousel
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-1.5">
        <span className="pointer-events-auto flex items-center gap-1">
          {playing ? (
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="grid size-6 place-items-center rounded bg-black/40 text-white outline-none backdrop-blur-sm transition-colors hover:bg-black/70"
            >
              {muted ? <SpeakerSimpleXIcon className="size-3.5" /> : <SpeakerSimpleHighIcon className="size-3.5" />}
            </button>
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on Instagram"
            title="Open on Instagram"
            className="grid size-6 place-items-center rounded bg-black/40 text-white outline-none backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <ArrowSquareOutIcon className="size-3.5" />
          </a>
        </span>
      </div>
    </div>
  );
}
