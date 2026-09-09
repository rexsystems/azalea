"use client";

import { useEffect, useState, type CSSProperties } from "react";
import CardSwap, { Card } from "./CardSwap";

const screenshots = [
  "/screenshots/1.png",
  "/screenshots/2.png",
  "/screenshots/3.png",
  "/screenshots/4.png",
  "/screenshots/5.png",
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function MobileScreenshotShowcase() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % screenshots.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="w-full max-w-full">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
        style={{ borderColor: "rgba(255, 255, 255, 0.12)", background: "#000" }}
      >
        {screenshots.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={`Azalea screenshot ${i + 1}`}
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-500"
            style={{ opacity: i === index ? 1 : 0 }}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        {screenshots.map((src, i) => (
          <button
            key={src}
            type="button"
            aria-label={`Show screenshot ${i + 1}`}
            aria-current={i === index}
            onClick={() => setIndex(i)}
            className="h-2.5 rounded-full transition-all"
            style={{
              width: i === index ? "1.5rem" : "0.5rem",
              background: i === index ? "var(--accent)" : "rgba(255, 255, 255, 0.22)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function useCardSwapLayout() {
  const [layout, setLayout] = useState({
    width: 620,
    height: 350,
    cardDistance: 48,
    verticalDistance: 56,
    skewAmount: 5,
    stackDirection: "up" as const,
  });

  useEffect(() => {
    const update = () => {
      setLayout({
        width: 620,
        height: 350,
        cardDistance: 48,
        verticalDistance: 56,
        skewAmount: 5,
        stackDirection: "up",
      });
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return layout;
}

export function AppPreview() {
  const isMobile = useIsMobile();
  const layout = useCardSwapLayout();
  const stackPad = (screenshots.length - 1) * layout.verticalDistance + 16;

  return (
    <div className="relative mx-auto w-full max-w-6xl px-0 sm:px-4 md:px-6">
      <div className="preview-glow" aria-hidden />

      <div className="rise delay-4 relative flex flex-col items-center gap-8 pt-4 pb-4 max-md:gap-10 md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center md:gap-6 md:pt-16 md:pb-16 lg:gap-10">
        <div className="order-1 w-full text-center md:order-none md:text-left">
          <p
            className="mb-3 text-sm uppercase tracking-[0.22em]"
            style={{ color: "var(--text-muted)" }}
          >
            A quick look
          </p>
          <h2
            className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl md:text-4xl lg:text-[2.75rem]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            5 different themes
          </h2>
          <p
            className="mx-auto mt-4 max-w-sm text-sm leading-relaxed sm:text-base md:mx-0"
            style={{ color: "var(--text-secondary)" }}
          >
            Five built-in color themes, including Glossy with frosted glass panels. Pick the look
            that fits your setup and switch anytime in Settings.
          </p>
        </div>

        <div
          className="app-preview-cards order-2 w-full max-w-full md:order-none md:mt-6 md:justify-end md:pr-2 lg:mt-8 lg:pr-0"
          style={{ "--card-stack-pad": `${stackPad}px` } as CSSProperties}
        >
          {isMobile ? (
            <MobileScreenshotShowcase />
          ) : (
            <div className="flex w-full justify-center md:justify-end">
              <CardSwap
                className="card-swap-container--stacked"
                width={layout.width}
                height={layout.height}
                cardDistance={layout.cardDistance}
                verticalDistance={layout.verticalDistance}
                stackDirection={layout.stackDirection}
                delay={4500}
                pauseOnHover
                skewAmount={layout.skewAmount}
              >
                {screenshots.map((src, i) => (
                  <Card key={src}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Azalea screenshot ${i + 1}`} draggable={false} />
                  </Card>
                ))}
              </CardSwap>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
